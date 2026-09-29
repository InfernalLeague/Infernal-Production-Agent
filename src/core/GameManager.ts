import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { GameState } from "@bluebottle_gg/league-broadcast-client";
import type {
  AllGameData,
  BroadcastGameEvent,
  BroadcastGameSnapshot,
  CreateGameInput,
  FinalLiveSnapshot,
  GameMeta,
  GoldSample,
  LiveTransportSource,
  ObjectiveKill,
  Side,
} from "../types.js";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import { ensureDirs, gameFolder, writeJsonAtomic } from "../util/storage.js";
import { checkLeagueProcesses } from "../util/processCheck.js";
import { LeagueDataCollector } from "../league/LeagueDataCollector.js";
import { GameSession } from "./GameSession.js";
import { buildConfirmedGame } from "../export/buildConfirmedGame.js";
import { exportConfirmedGame, type ExportMethod, type ExportResult } from "../export/exportConfirmedGame.js";
import { LeagueBroadcastCollector } from "../live/LeagueBroadcastCollector.js";
import { LiveStreamPublisher } from "../live/LiveStreamPublisher.js";
import type { DamageField, DamageProbe } from "../live/damageProbe.js";

/** Jak často jde živý stav běžící hry na web. */
const LIVE_WEB_INTERVAL_MS = 5000;
import { submitLive, submitResult, WebApiError } from "../web/WebClient.js";
import { publicWebSettings, tokenFor } from "../web/settings.js";

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
  private liveWebTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly collector: LeagueDataCollector,
    private readonly broadcast: LeagueBroadcastCollector,
    private readonly publisher: LiveStreamPublisher,
  ) {
    super();
    ensureDirs();
    this.collector.on("data", (d: AllGameData) => this.onData(d));
    this.collector.on("unreachable", () => this.onUnreachable());
    this.broadcast.on("snapshot", (snapshot: BroadcastGameSnapshot) => this.onBroadcastSnapshot(snapshot));
    this.broadcast.on("gameEvent", (event: BroadcastGameEvent) => this.onBroadcastEvent(event));
    this.broadcast.on("gameStatus", (status: GameState) => this.onBroadcastGameStatus(status));
    this.broadcast.on("status", () => this.emitUpdate());
    this.broadcast.on("damage", (damage: DamageProbe) => this.onBroadcastDamage(damage));
    this.publisher.on("status", () => this.emitUpdate());
  }

  start(): void {
    this.collector.start();
    this.broadcast.start();
    this.recoveryTimer = setInterval(() => this.writeRecovery(), config.recoveryIntervalMs);
    this.processTimer = setInterval(() => void this.refreshProcesses(), 3000);
    this.liveWebTimer = setInterval(() => void this.pushLiveToWeb(), LIVE_WEB_INTERVAL_MS);
    void this.refreshProcesses();
  }

  // --- vytvoření hry (workflow §5–§7) --------------------------------------

  /**
   * Smí nová hra nahradit aktuální? Ano, když žádná není, když ještě
   * nezačala (čeká na hru, žádná data), nebo když skončila a její výsledek
   * je vyřízený — zapsaný na webu, webem odmítnutý, nebo hra na web nepatří
   * (data zůstávají ve složce hry). Dohraná hra, které chybí vítěz nebo se
   * výsledek ještě odesílá, se nahradit nesmí.
   */
  canReplaceSession(): boolean {
    const s = this.session;
    if (!s || s.status === "EXPORTED") return true;
    if (s.status === "WAITING_FOR_GAME" || s.status === "CREATED") return !s.currentLive;
    if (s.status !== "GAME_ENDED") return false;
    if (!s.meta.web) return true;
    return s.webSync.state === "ok" || s.webSync.state === "rejected";
  }

  /** Aktuální hra (pro autopilota). */
  currentSession(): GameSession | null {
    return this.session;
  }

  createGame(input: CreateGameInput & { auto?: boolean; previousDuration?: number | null }): GameMeta {
    if (!this.canReplaceSession()) {
      throw new Error(
        this.session?.status === "LIVE"
          ? "Právě běží hra. Nová hra by přepsala rozpracovaná data."
          : "Aktuální hra čeká na vítěze nebo na zápis na web. Nejdřív ji dokonči.",
      );
    }
    const ended = this.session;
    if (ended?.meta.web && ended.finalSnapshot) this.previous = ended;
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
      web: input.web ?? null,
      auto: input.auto ?? false,
      previousDuration: input.previousDuration ?? null,
    };
    const folder = gameFolder(createdAt, meta.team1, meta.team2, meta.gameNumber, meta.localGameId);
    fs.mkdirSync(folder, { recursive: true });
    this.session = new GameSession(meta, folder);
    this.liveWeb = { state: "idle", message: null, at: null, gameTime: null };
    this.damage = { fields: new Set(), samples: 0, lastWrittenAt: 0 };
    this.publisher.beginGame(meta, folder);
    log.info(
      `Nová hra${meta.auto ? " (autopilot)" : ""}: ${meta.localGameId} (${meta.team1} vs ${meta.team2}, G${meta.gameNumber})`,
    );
    this.emitUpdate();
    return meta;
  }

  /**
   * Autopilot doplní hru, která ještě nezačala, podle čerstvého programu:
   * strany se na webu mění volbou strany v draftu až těsně před hrou.
   * Po startu hry se nic nemění — vítěz se ukládá jménem týmu.
   */
  updateWaitingGame(update: Pick<GameMeta, "team1" | "team2" | "team1Side" | "seriesFormat">): void {
    const s = this.session;
    if (!s || (s.status !== "WAITING_FOR_GAME" && s.status !== "CREATED") || s.currentLive) return;
    const m = s.meta;
    if (
      m.team1 === update.team1 &&
      m.team2 === update.team2 &&
      m.team1Side === update.team1Side &&
      m.seriesFormat === update.seriesFormat
    ) {
      return;
    }
    Object.assign(m, update);
    log.info(`${m.localGameId}: podle webu ${m.team1} (${m.team1Side}) vs ${m.team2}`);
    this.emitUpdate();
  }

  /** Stav autopilota pro dashboard (dodá ho Autopilot). */
  private autopilotState: () => unknown = () => null;

  setAutopilotState(provider: () => unknown): void {
    this.autopilotState = provider;
  }

  /** Překreslení dashboardu zvenčí (autopilot načetl program…). */
  notify(): void {
    this.emitUpdate();
  }

  /**
   * Patří data v čekající hře ještě předchozí hře?
   *
   * Po konci hry klient zůstává na výsledkové obrazovce a Live API dál vrací
   * dohranou hru (s eventem GameEnd a zastaveným časem). Autopilot mezitím
   * založí další hru — ta by jinak hned „začala“ se starými daty. Nová hra
   * se pozná tak, že předchozí zmizela (API přestalo odpovídat, LeagueBroadcast
   * hlásil OutOfGame), nebo podle herního času, který je výrazně pod délkou
   * předchozí hry — spectator se připojuje v prvních minutách.
   */
  private isPreviousGameData(s: GameSession, gameTime: number | null, gameEnded: boolean): boolean {
    if (s.status !== "WAITING_FOR_GAME" && s.status !== "CREATED") return false;
    if (gameEnded) return true;
    const previous = s.meta.previousDuration;
    if (previous == null || s.previousGameGone || gameTime == null) return false;
    return gameTime >= previous - 30;
  }

  /** Aktuální hra, nebo předchozí dohraná (`previous`), kterou autopilot už nahradil. */
  private target(which: "current" | "previous"): GameSession | null {
    return which === "previous" ? this.previous : this.session;
  }

  /**
   * Vítěz hry. Stejný vítěz, jakého Agent odhadl, jen potvrdí odhad
   * (zdroj „manual“) a na web se znovu neposílá.
   */
  setWinner(name: string | null, which: "current" | "previous" = "current"): void {
    const s = this.target(which);
    if (!s) return;
    if (name !== null && name !== s.meta.team1 && name !== s.meta.team2) {
      throw new Error("Vítěz musí být jeden z týmů hry.");
    }
    const changed = name !== s.winner;
    s.setWinner(name);
    this.emitUpdate();
    // Změna vítěze po konci hry jde na web znovu (produkce opravuje výsledek).
    // Potvrzení téhož vítěze (i odhadnutého) se neposílá, web by ho zapsal
    // jako opravu. Znovu odeslat jde tlačítkem „Odeslat znovu“.
    if (changed && (s.status === "GAME_ENDED" || s.status === "EXPORTED")) {
      void this.syncResult("změna vítěze", s);
    }
  }

  /** Ruční opětovné odeslání výsledku na web (tlačítko v dashboardu). */
  resendResult(which: "current" | "previous" = "current"): void {
    void this.syncResult("ručně", this.target(which));
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
    const gameEnded = (data.events?.Events ?? []).some((event) => event.EventName === "GameEnd");
    if (this.isPreviousGameData(s, data.gameData?.gameTime ?? null, gameEnded)) return;

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
    if (this.isPreviousGameData(s, snapshot.gameTime, false)) return;
    const wasWaiting = s.status !== "LIVE";
    const { goldSample, laneGold } = s.applyBroadcast(snapshot);
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
    if (goldSample) this.publishGoldSample(goldSample);
    if (laneGold) {
      this.publisher.publishEvent(
        { type: "gold.lane14", capturedAt: new Date().toISOString(), gameTime: laneGold.gameTime, payload: { ...laneGold } },
        "league-broadcast",
      );
      log.info(`${s.meta.localGameId}: gold hráčů ve 14. minutě zaznamenán`);
    }
    this.emitUpdate();
  }

  /**
   * Vzorek goldu týmů jako samostatná zpráva živého streamu. Web z nich
   * skládá graf, aniž by musel procházet každý `game.state` snapshot.
   */
  private publishGoldSample(sample: GoldSample): void {
    this.publisher.publishEvent(
      {
        type: "gold.sample",
        capturedAt: new Date().toISOString(),
        gameTime: sample.gameTime,
        payload: { ...sample },
      },
      "league-broadcast",
    );
  }

  private onBroadcastEvent(event: BroadcastGameEvent): void {
    const s = this.session;
    if (!s || (s.status !== "WAITING_FOR_GAME" && s.status !== "LIVE")) return;
    if (this.isPreviousGameData(s, event.gameTime, false)) return;
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
    if (status === GameState.OutOfGame && this.session && this.session.status !== "LIVE") {
      this.session.previousGameGone = true;
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
    if (s && (s.status === "WAITING_FOR_GAME" || s.status === "CREATED")) s.previousGameGone = true;
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

  private endCurrentGame(reason: string): void {
    if (!this.session) return;
    const finalGold = this.session.endGame();
    if (finalGold) this.publishGoldSample(finalGold);
    log.info(`${this.session.meta.localGameId}: GAME ENDED (${reason})`);
    this.logDamageSummary(this.session);
    this.suggestWinner(this.session);
    void this.syncResult("konec hry");
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


  // --- živý stav hry na web -----------------------------------------------

  /** Stav odesílání živých dat na web (pro dashboard). */
  private liveWeb: {
    state: "idle" | "ok" | "error";
    message: string | null;
    at: string | null;
    gameTime: number | null;
  } = { state: "idle", message: null, at: null, gameTime: null };
  private liveWebSending = false;

  /**
   * Živý stav běžící hry na web: každých `LIVE_WEB_INTERVAL_MS`, jen když
   * je hra LIVE, propojená s hrou na webu a Agent má token. Tvar je stejný
   * jako výsledek po hře, jen bez vítěze. Nepovedený pokus se neopakuje —
   * další stav přijde za pár sekund sám; do logu jde jen první chyba
   * a návrat spojení, ne každý pokus.
   */
  private async pushLiveToWeb(): Promise<void> {
    const s = this.session;
    if (!s || s.status !== "LIVE" || !s.meta.web || this.liveWebSending) return;
    if (!tokenFor(s.meta.web.production ?? null)) return;
    const snapshot = this.snapshotFromLive(s);
    if (!snapshot) return;

    this.liveWebSending = true;
    const gameTime = Math.round(snapshot.durationSeconds);
    try {
      await submitLive(
        s.meta.web.gameId,
        buildConfirmedGame(s.meta, snapshot, s.winner, s.winnerSource),
        gameTime,
        s.meta.web.production ?? null,
      );
      if (this.liveWeb.state !== "ok") log.info(`${s.meta.localGameId}: živý stav se posílá na web.`);
      this.liveWeb = { state: "ok", message: null, at: new Date().toISOString(), gameTime };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.liveWeb.state !== "error") log.warn(`${s.meta.localGameId}: živý stav se na web nezapsal: ${message}`);
      this.liveWeb = { ...this.liveWeb, state: "error", message };
    } finally {
      this.liveWebSending = false;
      this.emitUpdate();
    }
  }

  // --- diagnostika damage z LeagueBroadcastu (0.1.16) -----------------------

  /** Co z damage během aktuální hry přišlo; vzorky jdou do lb_damage.jsonl. */
  private damage: { fields: Set<DamageField>; samples: number; lastWrittenAt: number } = {
    fields: new Set(),
    samples: 0,
    lastWrittenAt: 0,
  };

  /**
   * Vzorek damage z LeagueBroadcastu ke hře: nejvýš jednou za 30 s, plus
   * vždy, když přijde pole, které v téhle hře ještě nebylo. Jen záznam pro
   * ověření, co LeagueBroadcast posílá; na výsledek hry to vliv nemá.
   */
  private onBroadcastDamage(damage: DamageProbe): void {
    const s = this.session;
    if (!s || s.status !== "LIVE") return;
    const newField = damage.fields.some((field) => !this.damage.fields.has(field));
    if (!newField && Date.now() - this.damage.lastWrittenAt < 30_000) return;

    for (const field of damage.fields) this.damage.fields.add(field);
    this.damage.samples += 1;
    this.damage.lastWrittenAt = Date.now();
    try {
      fs.appendFileSync(
        path.join(s.folder, "lb_damage.jsonl"),
        JSON.stringify({ capturedAt: new Date().toISOString(), ...damage }) + "\n",
        "utf8",
      );
    } catch (error) {
      log.warn(`${s.meta.localGameId}: vzorek damage se nezapsal: ${(error as Error).message}`);
    }
  }

  private logDamageSummary(s: GameSession): void {
    if (this.damage.samples === 0) {
      log.info(`${s.meta.localGameId}: LeagueBroadcast během hry žádná damage data neposlal.`);
      return;
    }
    log.info(
      `${s.meta.localGameId}: damage z LeagueBroadcastu: ${[...this.damage.fields].join(", ")} ` +
        `(${this.damage.samples} vzorků v lb_damage.jsonl).`,
    );
  }

  /** Dohraná hra, kterou autopilot nahradil další — vítěz jde dál opravit. */
  private previous: GameSession | null = null;

  /**
   * Výsledek hry na web: zapíše se a hra se na webu rovnou potvrdí.
   *
   * Posílá se po konci hry a po každé změně vítěze. Když web neodpovídá,
   * zkouší se to znovu každých 30 s. Když výsledek odmítne (cizí produkce,
   * výsledek už převzal admin…), opakování nepomůže — dashboard ukáže
   * hlášku z webu a operátor rozhodne.
   */
  private async syncResult(reason: string, s: GameSession | null = this.session): Promise<void> {
    if (!s?.meta.web || !s.finalSnapshot) return;
    if (s.webSync.state === "sending") {
      s.syncAgain = true;
      return;
    }
    if (s.syncTimer) clearTimeout(s.syncTimer);
    s.syncTimer = null;

    if (!s.winner) {
      s.webSync = { ...s.webSync, state: "error", message: "Chybí vítěz — zvol ho a výsledek se odešle.", at: new Date().toISOString() };
      this.emitUpdate();
      return;
    }

    s.webSync = { ...s.webSync, state: "sending", message: null };
    this.emitUpdate();
    const confirmed = buildConfirmedGame(s.meta, s.finalSnapshot, s.winner, s.winnerSource);
    writeJsonAtomic(path.join(s.folder, "confirmed.json"), confirmed);

    try {
      const result = await submitResult(s.meta.web.gameId, confirmed, s.meta.web.production ?? null);
      s.webSync = {
        state: "ok",
        message: null,
        revision: result.revision,
        unmatched: Array.isArray(result.unmatched) ? result.unmatched.length : 0,
        at: new Date().toISOString(),
      };
      log.info(`${s.meta.localGameId}: výsledek zapsán na web (${reason}, revize ${result.revision}, spárováno ${result.matched})`);
      // Web po zápisu vítěze sám založí další hru série — autopilot si pro ni sáhne.
      this.emit("resultSynced");
    } catch (error) {
      const retryable = error instanceof WebApiError ? error.retryable : true;
      const message = error instanceof Error ? error.message : String(error);
      s.webSync = { ...s.webSync, state: retryable ? "error" : "rejected", message, at: new Date().toISOString() };
      log.warn(`${s.meta.localGameId}: výsledek se na web nezapsal (${reason}): ${message}`);
      if (retryable) {
        s.syncTimer = setTimeout(() => void this.syncResult("opakování", s), 30_000);
      }
    }
    this.emitUpdate();

    if (s.syncAgain) {
      s.syncAgain = false;
      void this.syncResult("čekající změna", s);
    }
  }

  /**
   * Po konci hry předvyplní vítěze odhadem, pokud ho operátor ještě nezvolil.
   * Operátor ho před exportem vidí vybraného a může ho přepnout.
   */
  private suggestWinner(s: GameSession): void {
    if (s.winner) return;
    const side = s.suggestWinnerSide();
    if (!side) {
      log.warn(`${s.meta.localGameId}: vítěze se nepodařilo odhadnout, zvol ho ručně.`);
      return;
    }
    const team = side === s.meta.team1Side ? s.meta.team1 : s.meta.team2;
    s.setWinner(team, "auto");
    log.info(`${s.meta.localGameId}: odhadnutý vítěz ${team} (${side}) podle poslední zbourané budovy`);
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

    const confirmed = buildConfirmedGame(s.meta, snapshot, s.winner, s.winnerSource);
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
      goldTimeline: s.currentLive.goldTimeline,
      laneGoldAt14: s.currentLive.laneGoldAt14,
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
      leagueBroadcast: this.broadcast.getStatus(),
      liveDelivery: this.publisher.getStatus(),
      session: this.session ? this.session.toClient() : null,
      previous: this.previous ? this.previous.toClient() : null,
      liveWeb: this.liveWeb,
      web: publicWebSettings(),
      autopilot: this.autopilotState(),
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
