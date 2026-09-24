import type {
  AllGameData,
  BroadcastGameEvent,
  BroadcastGameSnapshot,
  FinalLiveSnapshot,
  FirstBloodInfo,
  GameMeta,
  GameObjectives,
  GameStatus,
  GoldSample,
  LivePlayerState,
  ObjectiveKill,
  ObjectiveKind,
  Side,
} from "../types.js";
import { firstBlood, normalizePlayers, teamKills } from "../league/normalize.js";
import {
  championKey,
  emptyObjectives,
  objectivesFromBroadcastEvent,
  EPIC_KINDS,
  objectivesFromEvents,
  pentakillsByChampion,
  STRUCTURE_KINDS,
  tallyObjectives,
} from "../league/objectives.js";

/**
 * GameSession (workflow §45): drží stav JEDNÉ hry a její live data v paměti.
 * Sám nepolluje API ani nepíše na disk – to dělá GameManager.
 */
/** Jak často (v sekundách herního času) se bere vzorek goldu. */
export const GOLD_SAMPLE_SECONDS = 30;

export class GameSession {
  meta: GameMeta;
  readonly folder: string;

  /** Aktuální live stav (přepisuje se při každém čtení, dokud hra běží). */
  currentLive: {
    durationSeconds: number;
    players: LivePlayerState[];
    teamKills: { BLUE: number; RED: number };
    teamGold: { BLUE: number | null; RED: number | null };
    firstBlood: FirstBloodInfo | null;
    objectives: GameObjectives;
    goldTimeline: GoldSample[];
  } | null = null;

  /**
   * Co se ví z event streamu Live API. Drží se mimo `currentLive`, protože
   * LeagueBroadcast snapshot `currentLive` celý přepisuje, a objektivy ani
   * pentakilly v něm nejsou.
   */
  private eventState: {
    objectives: GameObjectives;
    pentakills: Map<string, number>;
    firstBlood: FirstBloodInfo | null;
  } = { objectives: emptyObjectives(), pentakills: new Map(), firstBlood: null };

  /** Objektivy z LeagueBroadcast eventů — záloha, když Live API žádné nehlásí. */
  private broadcastKills: ObjectiveKill[] = [];
  private broadcastKillId = 0;

  /**
   * LeagueBroadcast v této hře už data dodal. Od té chvíle Live API hráče
   * nepřepisuje: ve spectatoru zaokrouhluje CS na desítky a gold nezná,
   * a po konci hry by jinak přepsalo přesná čísla těmi horšími.
   */
  broadcastSeen = false;

  /** Herní čas z Live API a kdy se naposledy pohnul (detekce konce hry). */
  liveClock: { gameTime: number; changedAt: number } | null = null;

  /** Poslední EventID z Live API zapsaný do riot_events.jsonl. */
  lastRiotEventId = -1;

  /**
   * Gold týmů a hráčů v průběhu hry, vzorek každých `GOLD_SAMPLE_SECONDS`
   * herního času. Jen z LeagueBroadcastu — Live API gold hráčů nezná.
   * Z týmových hodnot se na webu kreslí graf, z hráčských rozdíl proti
   * protivníkovi na stejné roli (stejný `slot`).
   */
  goldTimeline: GoldSample[] = [];

  /** Live API v této hře vrátilo aspoň jeden event (čte se event stream). */
  private riotEventsSeen = false;

  /**
   * Odkud je vítěz: `auto` = odhad Agenta po konci hry, `manual` = zvolil
   * operátor. Odhad nikdy nepřepíše volbu operátora.
   */
  winnerSource: "auto" | "manual" | null = null;

  /** Final live snapshot – po konci hry, už se NEMĚNÍ (workflow §16). */
  finalSnapshot: FinalLiveSnapshot | null = null;

  /** Vítěz – v 1A ho zadá operátor (Live spectator ho spolehlivě nedá). */
  winner: string | null = null;

  constructor(meta: GameMeta, folder: string) {
    this.meta = meta;
    this.folder = folder;
  }

  get status(): GameStatus {
    return this.meta.status;
  }

  setStatus(s: GameStatus): void {
    this.meta.status = s;
  }

  /** Zpracuje čerstvá live data (workflow §8–§12). */
  applyLive(data: AllGameData): void {
    this.applyLiveEvents(data);
    const players = this.withPentakills(normalizePlayers(data));
    this.currentLive = {
      durationSeconds: Math.round(data.gameData?.gameTime ?? 0),
      players,
      teamKills: teamKills(players),
      teamGold: { BLUE: null, RED: null },
      firstBlood: this.currentLive?.firstBlood ?? this.eventState.firstBlood,
      objectives: this.objectives(),
      goldTimeline: this.goldTimeline,
    };
    if (this.meta.status === "WAITING_FOR_GAME" || this.meta.status === "CREATED") {
      this.meta.status = "LIVE";
    }
  }

  /** LeagueBroadcast je primární bohatý zdroj (gold, itemy, rychlé změny). */
  /** Vrací nový vzorek goldu, pokud tímto snapshotem vznikl. */
  applyBroadcast(snapshot: BroadcastGameSnapshot): GoldSample | null {
    this.broadcastSeen = true;
    const previousTime = this.currentLive?.durationSeconds ?? 0;
    this.currentLive = {
      durationSeconds: Math.max(previousTime, Math.round(snapshot.gameTime)),
      players: this.withPentakills(snapshot.players.map((p) => ({ ...p, items: [...p.items] }))),
      teamKills: { ...snapshot.teamKills },
      teamGold: { ...snapshot.teamGold },
      firstBlood: this.currentLive?.firstBlood ?? this.eventState.firstBlood,
      objectives: this.objectives(),
      goldTimeline: this.goldTimeline,
    };
    if (this.meta.status === "WAITING_FOR_GAME" || this.meta.status === "CREATED") {
      this.meta.status = "LIVE";
    }
    return this.sampleGold(false);
  }

  /**
   * Vzorek goldu z aktuálního stavu. Bere se jednou za `GOLD_SAMPLE_SECONDS`
   * herního času (první vzorek v prvním intervalu, kdy LeagueBroadcast gold
   * posílá), `force` ho vezme hned — používá se na konci hry.
   */
  private sampleGold(force: boolean): GoldSample | null {
    const live = this.currentLive;
    if (!live || live.players.length === 0) return null;
    if (live.players.some((player) => player.gold === null || player.slot === undefined)) return null;

    const gameTime = live.durationSeconds;
    const last = this.goldTimeline.at(-1);
    if (last && gameTime <= last.gameTime) return null;
    if (!force && last && Math.floor(gameTime / GOLD_SAMPLE_SECONDS) <= Math.floor(last.gameTime / GOLD_SAMPLE_SECONDS)) {
      return null;
    }

    const sum = (side: "BLUE" | "RED") =>
      live.players.filter((player) => player.side === side).reduce((total, player) => total + (player.gold ?? 0), 0);
    const teams = { BLUE: live.teamGold.BLUE ?? sum("BLUE"), RED: live.teamGold.RED ?? sum("RED") };
    const sample: GoldSample = {
      gameTime,
      teams,
      diff: teams.BLUE - teams.RED,
      players: live.players.map((player) => ({
        side: player.side,
        slot: player.slot ?? 0,
        name: player.name,
        championName: player.championName,
        gold: player.gold ?? 0,
      })),
    };
    this.goldTimeline.push(sample);
    return sample;
  }

  /**
   * Odkud se berou objektivy daného druhu.
   *
   * Oba zdroje hlásí tytéž objektivy, jen jinak, takže se po druzích
   * **vybírají**, nesčítají — jinak by se každá věž započítala dvakrát.
   *   - věže a inhibitory: z Live API, jakmile čte event stream (zná přesnou
   *     budovu), jinak z LeagueBroadcastu,
   *   - draci, baroni, heraldi, voidgrubi, Atakhan: ve spectatoru je Live API
   *     nehlásí, takže z LeagueBroadcastu — pokud Live API nějaký epický
   *     objektiv přece jen nahlásí, má přednost ono (zná i krádeže).
   */
  private objectiveSource(kind: ObjectiveKind): "live" | "broadcast" {
    const live = this.eventState.objectives.timeline;
    if (STRUCTURE_KINDS.includes(kind)) return this.riotEventsSeen ? "live" : "broadcast";
    return live.some((kill) => EPIC_KINDS.includes(kill.kind)) ? "live" : "broadcast";
  }

  /** Objektivy hry složené z obou zdrojů podle `objectiveSource`. */
  objectives(): GameObjectives {
    const live = this.eventState.objectives.timeline.filter((kill) => this.objectiveSource(kill.kind) === "live");
    const broadcast = this.broadcastKills.filter((kill) => this.objectiveSource(kill.kind) === "broadcast");
    return tallyObjectives([...live, ...broadcast]);
  }

  /**
   * Odhad vítěze po konci hry: strana, které se počítala poslední zbouraná
   * budova v poslední minutě a půl hry. Nexus Live API nehlásí, ale před ním
   * padají nexusové věže a inhibitor vítězů. `GameEnd.Result` je ve
   * spectatoru k ničemu — vztahuje se k „vlastnímu“ hráči, který tu není.
   */
  suggestWinnerSide(): Side | null {
    const end = this.currentLive?.durationSeconds ?? 0;
    const structures = this.objectives().timeline.filter(
      (kill) => STRUCTURE_KINDS.includes(kill.kind) && kill.gameTime >= end - 90,
    );
    return structures.at(-1)?.side ?? null;
  }

  /**
   * Objektiv z LeagueBroadcast eventu. Vrací nově započtená zabití, ale jen
   * pokud se objektivy právě berou z LeagueBroadcastu (jinak by se do streamu
   * dostal tentýž drak podruhé).
   */
  applyBroadcastEvent(event: BroadcastGameEvent): ObjectiveKill[] {
    const kills = objectivesFromBroadcastEvent(event, () => -++this.broadcastKillId);
    if (kills.length === 0) return [];
    this.broadcastKills.push(...kills);
    if (this.currentLive) this.currentLive.objectives = this.objectives();
    return kills.filter((kill) => this.objectiveSource(kill.kind) === "broadcast");
  }

  /**
   * Objektivy, pentakilly a first blood z event streamu Live API.
   *
   * Volá se při každém pollu Live API, i když hráče právě dodává
   * LeagueBroadcast — dřív se v tu chvíli Live API zahodilo celé a pentakilly
   * zůstávaly na nule. Vrací objektivy, které přibyly od minulého volání.
   */
  applyLiveEvents(data: AllGameData) {
    if ((data.events?.Events ?? []).length > 0) this.riotEventsSeen = true;
    const known = new Set(this.eventState.objectives.timeline.map((kill) => kill.eventId));
    const objectives = objectivesFromEvents(data);
    // Event stream se po reconnectu může vrátit kratší; už započtené
    // objektivy se neztratí.
    if (objectives.timeline.length >= this.eventState.objectives.timeline.length) {
      this.eventState.objectives = objectives;
    }

    const pentakills = pentakillsByChampion(data);
    for (const [key, count] of pentakills) {
      this.eventState.pentakills.set(key, Math.max(count, this.eventState.pentakills.get(key) ?? 0));
    }

    // First blood je jednorázová událost – jakmile ho jednou zachytíme, držíme ho
    // (chrání proti výpadku/ořezu event streamu v pozdějším pollu).
    this.eventState.firstBlood ??= firstBlood(data);
    if (this.currentLive) {
      this.currentLive.objectives = this.objectives();
      this.currentLive.firstBlood ??= this.eventState.firstBlood;
      this.currentLive.players = this.withPentakills(this.currentLive.players);
    }

    return {
      newObjectives: this.eventState.objectives.timeline.filter(
        (kill) => !known.has(kill.eventId) && this.objectiveSource(kill.kind) === "live",
      ),
    };
  }

  private withPentakills(players: LivePlayerState[]): LivePlayerState[] {
    return players.map((player) => ({
      ...player,
      pentakills: Math.max(
        player.pentakills,
        this.eventState.pentakills.get(championKey(player.side, player.championName)) ?? 0,
      ),
    }));
  }

  /** Konec hry (workflow §15–§16): zmrazí poslední validní live stav. */
  /** Zmrazí stav a vrátí závěrečný vzorek goldu, pokud vznikl. */
  endGame(): GoldSample | null {
    const finalSample = this.sampleGold(true);
    if (this.currentLive) {
      this.finalSnapshot = {
        capturedAt: new Date().toISOString(),
        durationSeconds: this.currentLive.durationSeconds,
        players: this.currentLive.players.map((p) => ({ ...p, items: [...p.items] })),
        teamKills: { ...this.currentLive.teamKills },
        teamGold: { ...this.currentLive.teamGold },
        firstBlood: this.currentLive.firstBlood
          ? { ...this.currentLive.firstBlood }
          : null,
        objectives: structuredClone(this.currentLive.objectives),
        goldTimeline: structuredClone(this.goldTimeline),
      };
    }
    this.meta.status = "GAME_ENDED";
    return finalSample;
  }

  setWinner(name: string | null, source: "auto" | "manual" = "manual"): void {
    this.winner = name;
    this.winnerSource = name ? source : null;
  }

  /** Serializovatelný stav pro dashboard. */
  toClient() {
    return {
      meta: this.meta,
      winner: this.winner,
      winnerSource: this.winnerSource,
      live: this.currentLive,
      finalSnapshot: this.finalSnapshot,
      hasFinalSnapshot: this.finalSnapshot !== null,
    };
  }
}
