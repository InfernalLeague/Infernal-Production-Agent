import type {
  AllGameData,
  BroadcastGameSnapshot,
  Draft,
  FinalLiveSnapshot,
  FirstBloodInfo,
  GameMeta,
  GameStatus,
  LivePlayerState,
} from "../types.js";
import { firstBlood, normalizePlayers, teamKills } from "../league/normalize.js";

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
  } | null = null;

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
    const players = normalizePlayers(data);
    // First blood je jednorázová událost – jakmile ho jednou zachytíme, držíme ho
    // (chrání proti výpadku/ořezu event streamu v pozdějším pollu).
    const fb = this.currentLive?.firstBlood ?? firstBlood(data);
    this.currentLive = {
      durationSeconds: Math.round(data.gameData?.gameTime ?? 0),
      players,
      teamKills: teamKills(players),
      teamGold: { BLUE: null, RED: null },
      firstBlood: fb,
    };
    if (this.meta.status === "WAITING_FOR_GAME" || this.meta.status === "CREATED") {
      this.meta.status = "LIVE";
    }
  }

  /** LeagueBroadcast je primární bohatý zdroj (gold, itemy, rychlé změny). */
  applyBroadcast(snapshot: BroadcastGameSnapshot): void {
    const previousTime = this.currentLive?.durationSeconds ?? 0;
    const previousPentas = new Map(this.currentLive?.players.map((p) => [p.name, p.pentakills]) ?? []);
    this.currentLive = {
      durationSeconds: Math.max(previousTime, Math.round(snapshot.gameTime)),
      players: snapshot.players.map((p) => ({
        ...p,
        pentakills: Math.max(p.pentakills, previousPentas.get(p.name) ?? 0),
        items: [...p.items],
      })),
      teamKills: { ...snapshot.teamKills },
      teamGold: { ...snapshot.teamGold },
      firstBlood: this.currentLive?.firstBlood ?? null,
    };
    if (this.meta.status === "WAITING_FOR_GAME" || this.meta.status === "CREATED") {
      this.meta.status = "LIVE";
    }
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
