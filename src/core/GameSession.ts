import type {
  AllGameData,
  BroadcastGameEvent,
  BroadcastGameSnapshot,
  Draft,
  FinalLiveSnapshot,
  FirstBloodInfo,
  GameMeta,
  GameObjectives,
  GameStatus,
  LivePlayerState,
  ObjectiveKill,
} from "../types.js";
import { firstBlood, normalizePlayers, teamKills } from "../league/normalize.js";
import {
  championKey,
  emptyObjectives,
  objectivesFromBroadcastEvent,
  objectivesFromEvents,
  pentakillsByChampion,
  tallyObjectives,
} from "../league/objectives.js";

/**
 * GameSession (workflow §45): drží stav JEDNÉ hry a její live data v paměti.
 * Sám nepolluje API ani nepíše na disk – to dělá GameManager.
 */
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

  /** Final live snapshot – po konci hry, už se NEMĚNÍ (workflow §16). */
  finalSnapshot: FinalLiveSnapshot | null = null;

  /** Vítěz – v 1A ho zadá operátor (Live spectator ho spolehlivě nedá). */
  winner: string | null = null;

  /** Draft z champ selectu (bany + picky), pokud byl zachycen. */
  draft: Draft | null = null;

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
    };
    if (this.meta.status === "WAITING_FOR_GAME" || this.meta.status === "CREATED") {
      this.meta.status = "LIVE";
    }
  }

  /** LeagueBroadcast je primární bohatý zdroj (gold, itemy, rychlé změny). */
  applyBroadcast(snapshot: BroadcastGameSnapshot): void {
    this.broadcastSeen = true;
    const previousTime = this.currentLive?.durationSeconds ?? 0;
    this.currentLive = {
      durationSeconds: Math.max(previousTime, Math.round(snapshot.gameTime)),
      players: this.withPentakills(snapshot.players.map((p) => ({ ...p, items: [...p.items] }))),
      teamKills: { ...snapshot.teamKills },
      teamGold: { ...snapshot.teamGold },
      firstBlood: this.currentLive?.firstBlood ?? this.eventState.firstBlood,
      objectives: this.objectives(),
    };
    if (this.meta.status === "WAITING_FOR_GAME" || this.meta.status === "CREATED") {
      this.meta.status = "LIVE";
    }
  }

  /**
   * Objektivy hry: z Live API, a když to žádné nehlásí, z LeagueBroadcastu.
   *
   * Zdroje se nemíchají — oba hlásí tytéž objektivy, jen jinak, a sloučení by
   * je zdvojilo. Live API má přednost, protože zná i krádeže a přesné budovy.
   */
  objectives(): GameObjectives {
    if (this.eventState.objectives.timeline.length > 0) return this.eventState.objectives;
    return tallyObjectives(this.broadcastKills);
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
    return this.eventState.objectives.timeline.length > 0 ? [] : kills;
  }

  /**
   * Objektivy, pentakilly a first blood z event streamu Live API.
   *
   * Volá se při každém pollu Live API, i když hráče právě dodává
   * LeagueBroadcast — dřív se v tu chvíli Live API zahodilo celé a pentakilly
   * zůstávaly na nule. Vrací objektivy, které přibyly od minulého volání.
   */
  applyLiveEvents(data: AllGameData) {
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
      newObjectives: this.eventState.objectives.timeline.filter((kill) => !known.has(kill.eventId)),
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
  endGame(): void {
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
      };
    }
    this.meta.status = "GAME_ENDED";
  }

  setWinner(name: string | null): void {
    this.winner = name;
  }

  /** Serializovatelný stav pro dashboard. */
  toClient() {
    return {
      meta: this.meta,
      winner: this.winner,
      draft: this.draft,
      live: this.currentLive,
      finalSnapshot: this.finalSnapshot,
      hasFinalSnapshot: this.finalSnapshot !== null,
    };
  }
}
