import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { GameState } from "@bluebottle_gg/league-broadcast-client";
import type {
  AllGameData,
  BroadcastGameEvent,
  BroadcastGameSnapshot,
  CreateGameInput,
  Draft,
  FinalLiveSnapshot,
  GameMeta,
  LiveTransportSource,
  ObjectiveKill,
  Side,
} from "../types.js";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import { ensureDirs, gameFolder, writeJsonAtomic } from "../util/storage.js";
import { checkLeagueProcesses } from "../util/processCheck.js";
import { LeagueDataCollector } from "../league/LeagueDataCollector.js";
import { ChampSelectCollector } from "../champselect/ChampSelectCollector.js";
import { GameSession } from "./GameSession.js";
import { buildConfirmedGame } from "../export/buildConfirmedGame.js";
import { exportConfirmedGame, type ExportMethod, type ExportResult } from "../export/exportConfirmedGame.js";
import { LeagueBroadcastCollector } from "../live/LeagueBroadcastCollector.js";
import { LiveStreamPublisher } from "../live/LiveStreamPublisher.js";

/**
 * GameManager: orchestrátor Fáze 1A.
 * - drží aktuální GameSession,
 * - napojuje LeagueDataCollector na stavový automat (WAITING → LIVE → ENDED),
 * - řeší timeout konce hry (§15), recovery snapshoty (§13) a detekci procesů (§4),
 * - spouští export (§39).
 * Emituje "update" při každé změně stavu → server přepošle na dashboard.
 */
export class GameManager extends EventEmitter {
  private session: GameSession | null = null;
  private processes = { client: false, game: false };
  private recoveryTimer: NodeJS.Timeout | null = null;
  private processTimer: NodeJS.Timeout | null = null;
  private broadcastEndTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly collector: LeagueDataCollector,
    private readonly champSelect: ChampSelectCollector,
    private readonly broadcast: LeagueBroadcastCollector,
    private readonly publisher: LiveStreamPublisher,
  ) {
    super();
    ensureDirs();
    this.collector.on("data", (d: AllGameData) => this.onData(d));
    this.collector.on("unreachable", () => this.onUnreachable());
    this.champSelect.on("draft", (draft: Draft | null) => this.onDraft(draft));
    this.broadcast.on("snapshot", (snapshot: BroadcastGameSnapshot) => this.onBroadcastSnapshot(snapshot));
    this.broadcast.on("gameEvent", (event: BroadcastGameEvent) => this.onBroadcastEvent(event));
    this.broadcast.on("gameStatus", (status: GameState) => this.onBroadcastGameStatus(status));
    this.broadcast.on("status", () => this.emitUpdate());
    this.publisher.on("status", () => this.emitUpdate());
  }

  start(): void {
    this.collector.start();
    this.champSelect.start();
    this.broadcast.start();
    this.recoveryTimer = setInterval(() => this.writeRecovery(), config.recoveryIntervalMs);
    this.processTimer = setInterval(() => void this.refreshProcesses(), 3000);
    void this.refreshProcesses();
  }

  // --- vytvoření hry (workflow §5–§7) --------------------------------------

  createGame(input: CreateGameInput): GameMeta {
    if (this.session && this.session.status !== "EXPORTED") {
      throw new Error("Nejdřív ukonči a exportuj aktuální hru. Nová hra by přepsala rozpracovaná data.");
    }
    const team1 = input.team1.trim();
    const team2 = input.team2.trim();
    if (!team1 || !team2) throw new Error("Názvy obou týmů jsou povinné.");
    if (!Number.isInteger(input.gameNumber) || input.gameNumber < 1) {
      throw new Error("Číslo hry musí být celé číslo větší než nula.");
    }
    const createdAt = new Date().toISOString();
    const team1Side: Side = input.team1Side ?? "BLUE";
    const meta: GameMeta = {
      localGameId: this.nextLocalGameId(createdAt),
      team1,
      team2,
      gameNumber: input.gameNumber,
      seriesFormat: input.seriesFormat,
      production: input.production?.trim() || undefined,
      team1Side,
      createdAt,
      status: "WAITING_FOR_GAME",
    };
    const folder = gameFolder(createdAt, meta.team1, meta.team2, meta.gameNumber, meta.localGameId);
    fs.mkdirSync(folder, { recursive: true });
    this.session = new GameSession(meta, folder);
    this.publisher.beginGame(meta, folder);
    log.info(`Nová hra: ${meta.localGameId} (${meta.team1} vs ${meta.team2}, G${meta.gameNumber})`);
    this.emitUpdate();
    return meta;
  }

  setWinner(name: string | null): void {
    if (!this.session) return;
    if (name !== null && name !== this.session.meta.team1 && name !== this.session.meta.team2) {
      throw new Error("Vítěz musí být jeden z týmů aktuální hry.");
    }
    this.session.setWinner(name);
    this.emitUpdate();
  }

  /** Ruční ukončení hry operátorem (kdyby autodetekce nestačila). */
  forceEndGame(): void {
    if (this.session && this.session.status === "LIVE") {
      this.endCurrentGame("ruční ukončení");
    }
  }

  // --- reakce na collector -------------------------------------------------

  private onData(data: AllGameData): void {
    if (!this.session) return; // data ignorujeme, dokud operátor nezaložil hru
    const s = this.session;
    if (s.status !== "WAITING_FOR_GAME" && s.status !== "CREATED" && s.status !== "LIVE") return;

    // Event stream Live API (objektivy, pentakilly, first blood) se čte vždy.
    // LeagueBroadcast je primární jen pro statistiky hráčů — objektivy
    // s typem draka a krádeží ani pentakilly z něj nemáme.
    this.recordRiotEvents(s, data);
    const { newObjectives } = s.applyLiveEvents(data);
    this.publishObjectives(newObjectives, config.mock ? "mock" : "riot-live-api");

    if (s.status === "LIVE" && this.detectLiveApiEnd(s, data)) return;

    // Hráče dodává WebSocket; Riot API je pro ně fallback. Jakmile v této hře
    // LeagueBroadcast jednou data dal, Live API hráče přepíše, jen když hra
    // jde dál bez něj — ne po konci hry, kdy by přesná čísla nahradilo CS
    // zaokrouhlené na desítky a prázdným goldem.
    const liveTime = data.gameData?.gameTime ?? 0;
    const broadcastAhead = s.broadcastSeen && liveTime <= (s.currentLive?.durationSeconds ?? 0) + 5;
    if (this.broadcast.isFresh() || broadcastAhead) {
      if (newObjectives.length > 0) this.emitUpdate();
      return;
    }
    if (s.status === "WAITING_FOR_GAME" || s.status === "CREATED") {
      log.info(`${s.meta.localGameId}: hra začala → LIVE`);
    }
    if (s.status === "WAITING_FOR_GAME" || s.status === "CREATED" || s.status === "LIVE") {
      s.applyLive(data);
      const snapshot = this.transportSnapshot(s);
      if (snapshot) this.publisher.publishSnapshot(snapshot, config.mock ? "mock" : "riot-live-api");
      this.emitUpdate();
    }
  }

  private onBroadcastSnapshot(snapshot: BroadcastGameSnapshot): void {
    const s = this.session;
    if (!s || (s.status !== "CREATED" && s.status !== "WAITING_FOR_GAME" && s.status !== "LIVE")) return;
    const wasWaiting = s.status !== "LIVE";
    s.applyBroadcast(snapshot);
    if (wasWaiting) log.info(`${s.meta.localGameId}: LeagueBroadcast detekoval hru → LIVE`);
    this.publisher.publishSnapshot(
      {
        ...snapshot,
        // Pentakilly a objektivy doplněné z Live API eventů.
        players: s.currentLive?.players ?? snapshot.players,
        objectives: s.currentLive?.objectives,
      },
      "league-broadcast",
    );
    this.emitUpdate();
  }

  private onBroadcastEvent(event: BroadcastGameEvent): void {
    const s = this.session;
    if (!s || (s.status !== "WAITING_FOR_GAME" && s.status !== "LIVE")) return;
    this.publisher.publishEvent(event);
    this.publishObjectives(s.applyBroadcastEvent(event), "league-broadcast");

    if (event.type === "champion.kill" && s.currentLive && !s.currentLive.firstBlood) {
      const killer = (event.payload.killer ?? null) as { playerName?: string | null } | null;
      const player = killer?.playerName
        ? s.currentLive.players.find((candidate) => candidate.name === killer.playerName)
        : null;
      if (player) s.currentLive.firstBlood = { playerName: player.name, side: player.side };
    }
    this.emitUpdate();
  }

  /**
   * Surový event stream Live API do `riot_events.jsonl` ve složce hry.
   *
   * Po první zkušební hře nešlo zjistit, proč z Live API nepřišel ani jeden
   * objektiv — Agent surová data neukládal. Zapisují se jen nové eventy
   * (podle EventID), takže soubor zůstává malý.
   */
  private recordRiotEvents(s: GameSession, data: AllGameData): void {
    const events = (data.events?.Events ?? []).filter((event) => event.EventID > s.lastRiotEventId);
    if (events.length === 0) return;
    try {
      const capturedAt = new Date().toISOString();
      const gameTime = data.gameData?.gameTime ?? null;
      fs.appendFileSync(
        path.join(s.folder, "riot_events.jsonl"),
        events.map((event) => JSON.stringify({ capturedAt, gameTime, event })).join("\n") + "\n",
        "utf8",
      );
    } catch (error) {
      log.warn("Zápis riot_events.jsonl selhal:", error);
    }
    s.lastRiotEventId = Math.max(s.lastRiotEventId, ...events.map((event) => event.EventID));
  }

  /**
   * Konec hry podle Live API.
   *
   * Při zkušebním spectatu zůstal klient po konci hry na výsledkové obrazovce:
   * Live API dál odpovídalo, LeagueBroadcast konec nenahlásil, a hra se
   * ukončila až ručně o 44 minut později. Proto:
   *   1. event `GameEnd` v Live API → konec hned,
   *   2. herní čas stojí 20 s, LeagueBroadcast nedodává data a nehlásí pauzu
   *      → konec. Pauza sama hru neukončí: LeagueBroadcast ji hlásí stavem
   *      `Paused`, a dokud posílá snapshoty, je čerstvý.
   */
  private detectLiveApiEnd(s: GameSession, data: AllGameData): boolean {
    const gameEnd = (data.events?.Events ?? []).find((event) => event.EventName === "GameEnd");
    if (gameEnd) {
      this.endCurrentGame(`Live API GameEnd (Result: ${String(gameEnd.Result ?? "?")})`);
      return true;
    }

    const gameTime = data.gameData?.gameTime ?? 0;
    const now = Date.now();
    if (!s.liveClock || gameTime !== s.liveClock.gameTime) {
      s.liveClock = { gameTime, changedAt: now };
      return false;
    }

    const frozenFor = now - s.liveClock.changedAt;
    const paused = this.broadcast.getStatus().gameState === "Paused";
    if (gameTime > 60 && frozenFor >= 20_000 && !this.broadcast.isFresh() && !paused) {
      this.endCurrentGame(`herní čas stojí ${Math.round(frozenFor / 1000)} s a LeagueBroadcast mlčí`);
      return true;
    }
    return false;
  }

  /** Nově padlé objektivy jako diskrétní eventy živého streamu. */
  private publishObjectives(kills: ObjectiveKill[], source: LiveTransportSource): void {
    const s = this.session;
    if (!s) return;
    for (const kill of kills) {
      const team = kill.side === s.meta.team1Side ? s.meta.team1 : s.meta.team2;
      this.publisher.publishEvent(
        {
          type: "objective.kill",
          capturedAt: new Date().toISOString(),
          gameTime: kill.gameTime,
          payload: { ...kill, team },
        },
        source,
      );
      log.info(
        `${s.meta.localGameId}: ${kill.kind}${kill.dragonType ? ` (${kill.dragonType})` : ""}${kill.stolen ? " ukradený" : ""} → ${team}`,
      );
    }
  }

  private onBroadcastGameStatus(status: GameState): void {
    log.info(`LeagueBroadcast stav hry: ${GameState[status] ?? status}`);
    if (status === GameState.Running || status === GameState.Paused) {
      if (this.broadcastEndTimer) clearTimeout(this.broadcastEndTimer);
      this.broadcastEndTimer = null;
      return;
    }
    if (status === GameState.GameOver && this.session?.status === "LIVE") {
      this.endCurrentGame("LeagueBroadcast oznámil konec hry");
      return;
    }
    if (status === GameState.OutOfGame && this.session?.status === "LIVE") {
      // BlueBottle používá OutOfGame i při pouhém odpojení socketu. Krátká
      // prodleva rozliší skutečný stav serveru (socket zůstane připojený) od
      // výpadku, při kterém dál rozhoduje 12s Riot fallback.
      if (this.broadcastEndTimer) clearTimeout(this.broadcastEndTimer);
      this.broadcastEndTimer = setTimeout(() => {
        const state = this.broadcast.getStatus();
        if (state.connected && state.gameState === "OutOfGame" && this.session?.status === "LIVE") {
          this.endCurrentGame("LeagueBroadcast přešel do OutOfGame");
        }
      }, 1500);
    }
  }

  private onUnreachable(): void {
    const s = this.session;
    if (!s || s.status !== "LIVE") {
      this.emitUpdate();
      return;
    }
    // Konec hry potvrdíme až po timeoutu (§15), aby to nebyl jen výpadek.
    const silentFor = this.collector.lastOkAt ? Date.now() - this.collector.lastOkAt : 0;
    if (silentFor >= config.gameEndTimeoutMs) {
      this.endCurrentGame(`Live API mlčí ${Math.round(silentFor / 1000)}s`);
    } else {
      this.emitUpdate();
    }
  }

  /**
   * Champ select draft. Aplikujeme jen dokud hra nezačala (CREATED/WAITING),
   * ať draft další hry nepřepíše už zmrazený draft rozehrané/skončené hry.
   * Když draft skončí (null), poslední zachycený zůstává (zmrazený).
   *
   * Pozor na přechod champ select → hra: poslední čtení LCU těsně před startem
   * hry se často vrátí "rozpadlé" (akce už nejsou completed → prázdné bany/picky).
   * Takový chudší draft NESMÍ přepsat už zachycený bohatší draft, jinak se bany
   * ztratí a nedostanou se do exportu. Proto ukládáme jen lepší/kompletnější draft.
   */
  private onDraft(draft: Draft | null): void {
    if (!draft || !this.session) return;
    const st = this.session.status;
    if (st !== "CREATED" && st !== "WAITING_FOR_GAME") return;
    const prev = this.session.draft;
    if (prev && !this.isBetterDraft(draft, prev)) return;
    this.session.draft = draft;
    this.emitUpdate();
  }

  /**
   * Je `next` draft aspoň tak dobrý jako `prev`? Bere v úvahu, že normální
   * průběh draftu jen přidává bany/picky (počet roste), zatímco degradovaný
   * read na konci champ selectu je vynuluje.
   *  - Kompletní draft je zmrazený → nic ho nepřepíše.
   *  - Kompletní `next` vždy vyhrává nad nekompletním `prev`.
   *  - Jinak vyhrává ten s víc zachycenými bany+picky (při shodě necháme novější).
   */
  private isBetterDraft(next: Draft, prev: Draft): boolean {
    if (prev.complete) return false;
    if (next.complete) return true;
    const richness = (d: Draft): number => d.bans.length + d.picks.length;
    return richness(next) >= richness(prev);
  }

  private endCurrentGame(reason: string): void {
    if (!this.session) return;
    this.session.endGame();
    log.info(`${this.session.meta.localGameId}: GAME ENDED (${reason})`);
    if (this.session.finalSnapshot) {
      writeJsonAtomic(path.join(this.session.folder, "live_final.json"), this.session.finalSnapshot);
    }
    this.publisher.finalize(
      this.session.finalSnapshot?.durationSeconds ?? null,
      this.currentTransportSource(),
      this.transportSnapshot(this.session) ?? undefined,
    );
    this.emitUpdate();
  }

  // --- recovery & procesy --------------------------------------------------

  private writeRecovery(): void {
    const s = this.session;
    if (!s || s.status !== "LIVE" || !s.currentLive) return;
    writeJsonAtomic(path.join(config.paths.data, "current_game", "live_snapshot.json"), {
      meta: s.meta,
      live: s.currentLive,
      savedAt: new Date().toISOString(),
    });
  }

  private async refreshProcesses(): Promise<void> {
    const before = JSON.stringify(this.processes);
    this.processes = await checkLeagueProcesses();
    if (JSON.stringify(this.processes) !== before) this.emitUpdate();
  }

  // --- export (workflow §39, §41, §50) -------------------------------------

  async exportTxt(): Promise<ExportResult> {
    return this.doExport("txt");
  }

  private async doExport(method: ExportMethod): Promise<ExportResult> {
    const s = this.session;
    if (!s) throw new Error("Není založená žádná hra.");
    const snapshot: FinalLiveSnapshot | null = s.finalSnapshot ?? this.snapshotFromLive(s);
    if (!snapshot) throw new Error("Zatím nejsou žádná live data k exportu.");

    const confirmed = buildConfirmedGame(s.meta, snapshot, s.winner, s.draft);
    // confirmed.json = source of truth (§50)
    writeJsonAtomic(path.join(s.folder, "confirmed.json"), confirmed);

    const result = await exportConfirmedGame(confirmed, method, s.folder);
    s.setStatus("EXPORTED");
    log.info(`${s.meta.localGameId}: EXPORT ${method.toUpperCase()} → ${result.filename}`);
    this.emitUpdate();
    return result;
  }

  /** Dovolí export i bez formálního "konce hry" (z aktuálních live dat). */
  private snapshotFromLive(s: GameSession): FinalLiveSnapshot | null {
    if (!s.currentLive) return null;
    return {
      capturedAt: new Date().toISOString(),
      durationSeconds: s.currentLive.durationSeconds,
      players: s.currentLive.players,
      teamKills: s.currentLive.teamKills,
      teamGold: s.currentLive.teamGold,
      firstBlood: s.currentLive.firstBlood,
      objectives: s.currentLive.objectives,
    };
  }

  // --- stav pro dashboard --------------------------------------------------

  getState() {
    return {
      mock: config.mock,
      leagueClient: this.processes.client,
      leagueGame: this.processes.game,
      liveApiReachable: this.collector.reachable,
      lastOkAt: this.collector.lastOkAt,
      champSelectActive: this.champSelect.active,
      leagueBroadcast: this.broadcast.getStatus(),
      liveDelivery: this.publisher.getStatus(),
      session: this.session ? this.session.toClient() : null,
    };
  }

  private emitUpdate(): void {
    this.emit("update", this.getState());
  }

  private transportSnapshot(s: GameSession): BroadcastGameSnapshot | null {
    if (!s.currentLive) return null;
    return {
      capturedAt: new Date().toISOString(),
      gameTime: s.currentLive.durationSeconds,
      players: s.currentLive.players.map((player) => ({ ...player, items: [...player.items] })),
      teamKills: { ...s.currentLive.teamKills },
      teamGold: { ...s.currentLive.teamGold },
      patch: null,
      objectives: s.currentLive.objectives,
    };
  }

  private currentTransportSource(): "league-broadcast" | "riot-live-api" | "mock" {
    if (config.mock) return "mock";
    return this.broadcast.isFresh() ? "league-broadcast" : "riot-live-api";
  }

  private nextLocalGameId(dateIso: string): string {
    const date = dateIso.slice(0, 10);
    const counterFile = path.join(config.paths.data, "game_counter.json");
    let n = 1;
    try {
      const raw = JSON.parse(fs.readFileSync(counterFile, "utf8")) as { date: string; n: number };
      if (raw.date === date) n = raw.n + 1;
    } catch {
      /* první hra dne */
    }
    writeJsonAtomic(counterFile, { date, n });
    return `ILT-${date}-${String(n).padStart(3, "0")}`;
  }
}
