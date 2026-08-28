/**
 * Doménové typy Infernal Production Agenta.
 *
 * Klíčový princip (viz workflow §69): aplikace NENÍ "League → TXT".
 * Vše míří do jednoho objektu `ConfirmedGame`, který je jediný source of truth.
 * Exportery (TXT nyní, Database později) z něj jen čtou.
 */

/** Stavový automat hry (workflow §61). */
export type GameStatus =
  | "CREATED"
  | "WAITING_FOR_GAME"
  | "LIVE"
  | "GAME_ENDED"
  | "AWAITING_SCREENSHOT"     // od Fáze 1B
  | "PROCESSING_SCREENSHOT"   // od Fáze 1B
  | "REVIEW_REQUIRED"         // od Fáze 1C
  | "READY_TO_CONFIRM"
  | "CONFIRMED"
  | "EXPORTED";

/** Strana na mapě. ORDER = modrá, CHAOS = červená (názvosloví Live Client API). */
export type Side = "BLUE" | "RED";

/**
 * First blood (workflow: první zabití šampiona ve hře).
 * Detekováno z Live event streamu (první `ChampionKill`), viz normalize.ts.
 * Ve snapshotu držíme jen jméno a stranu; název týmu se dopočítá až
 * v buildConfirmedGame (potřebuje meta.team1Side).
 */
export interface FirstBloodInfo {
  playerName: string;
  side: Side;
}

/** Odkud pochází výsledná hodnota (workflow §46–47). */
export type ValueSource =
  | "live"        // z Live Client Data
  | "screenshot"  // z post-game screenshotu (Fáze 1B+)
  | "verified"    // live i screenshot se shodly (Fáze 1C+)
  | "manual"      // ručně zadané operátorem
  | null;         // hodnota není k dispozici

/** Formát série. */
export type SeriesFormat = "BO1" | "BO3" | "BO5" | string;

/** Parametry pro založení nové hry (workflow §5). */
export interface CreateGameInput {
  team1: string;
  team2: string;
  gameNumber: number;
  seriesFormat: SeriesFormat;
  production?: string;
  /** Která z týmů je na modré straně. Default: team1. (Strany se v sérii mění.) */
  team1Side?: Side;
}

/** Interní identifikace hry (workflow §6). NEpoužíváme League Game ID. */
export interface GameMeta {
  localGameId: string;
  team1: string;
  team2: string;
  gameNumber: number;
  seriesFormat: SeriesFormat;
  production?: string;
  team1Side: Side;
  createdAt: string;         // ISO
  status: GameStatus;
}

/**
 * Jeden hráč ve finálním potvrzeném datasetu (workflow §38).
 * Hodnoty null = zatím/nejsou k dispozici (např. damage/gold bez screenshotu).
 * Ke každé "spojované" statistice držíme i její zdroj.
 */
export interface ConfirmedPlayer {
  name: string;
  team: string;            // název týmu (team1/team2 name)
  side: Side;
  championName: string;
  level: number | null;

  kills: number | null;
  deaths: number | null;
  assists: number | null;
  cs: number | null;
  vision: number | null;         // Vision Score, jen z Live (workflow §23)
  damage: number | null;         // primárně ze screenshotu (§22)
  gold: number | null;           // primárně ze screenshotu (§22)
  goldPerMinute: number | null;  // primárně ze screenshotu (§22)
  pentakills: number;
  items: number[];               // itemID list z Live

  sources: {
    kills: ValueSource;
    deaths: ValueSource;
    assists: ValueSource;
    cs: ValueSource;
    vision: ValueSource;
    damage: ValueSource;
    gold: ValueSource;
    goldPerMinute: ValueSource;
  };
}

/** Tým ve finálním datasetu. */
export interface ConfirmedTeam {
  name: string;
  side: Side;
  kills: number | null;
  gold: number | null;   // až ze screenshotu (§22)
}

/**
 * Finální potvrzený dataset = source of truth (workflow §38, §50).
 * TXT i budoucí Database export vznikají POUZE z tohoto objektu.
 */
export interface ConfirmedGame {
  game: {
    localGameId: string;
    team1: string;
    team2: string;
    gameNumber: number;
    seriesFormat: SeriesFormat;
    production?: string;
    durationSeconds: number | null;
    winner: string | null;        // název vítězného týmu; v 1A zadá operátor
    firstBloodPlayer: string | null; // hráč, který udělal first blood (§ live events)
    firstBloodTeam: string | null;   // tým hráče s first blood
    createdAt: string;
    confirmedAt: string | null;
    status: GameStatus;
  };
  teams: ConfirmedTeam[];
  players: ConfirmedPlayer[];
  draft: Draft | null; // bany + picky z champ selectu (pokud byl zachycen)
}

// ---------------------------------------------------------------------------
// Champ select / draft (LCU API klienta)
// ---------------------------------------------------------------------------

/** Jeden ban v draftu. */
export interface DraftBan {
  side: Side;
  championId: number;
  championName: string;
  order: number; // pořadí banu v rámci dané strany (1..n)
}

/** Jeden pick v draftu (navázaný na hráče přes cellId). */
export interface DraftPick {
  side: Side;
  cellId: number;
  championId: number;
  championName: string;
  order: number;     // pořadí picku v rámci dané strany (1..n)
  position: string;  // top/jungle/middle/bottom/utility, pokud známe
}

/** Normalizovaný draft jedné hry (bany + picky v pořadí). */
export interface Draft {
  capturedAt: string;
  complete: boolean;
  bans: DraftBan[];
  picks: DraftPick[];
}

// --- surová data z LCU champ select session --------------------------------

export interface LcuAction {
  id: number;
  actorCellId: number;
  championId: number;
  completed: boolean;
  type: string; // "ban" | "pick" | "ten_bans_reveal" | ...
  isInProgress: boolean;
}

export interface LcuTeamMember {
  cellId: number;
  championId: number;
  summonerId?: number;
  assignedPosition?: string;
}

export interface LcuChampSelectSession {
  actions: LcuAction[][];
  bans: { myTeamBans: number[]; theirTeamBans: number[]; numBans: number };
  myTeam: LcuTeamMember[];
  theirTeam: LcuTeamMember[];
  localPlayerCellId: number;
  timer?: { phase?: string; adjustedTimeLeftInPhase?: number };
}

/** Položka z LCU champion-summary.json (mapování id → jméno). */
export interface LcuChampionSummary {
  id: number;
  name: string;
  alias: string;
}

// ---------------------------------------------------------------------------
// Live Client Data API (surová data z LoL, https://127.0.0.1:2999)
// ---------------------------------------------------------------------------

export interface RiotItem {
  itemID: number;
  count: number;
  slot: number;
  displayName?: string;
}

export interface RiotScores {
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  wardScore: number;
}

export interface RiotPlayer {
  championName: string;
  summonerName?: string;
  riotIdGameName?: string;
  riotId?: string;
  team: "ORDER" | "CHAOS";
  level: number;
  position?: string;
  scores: RiotScores;
  items: RiotItem[];
  isDead?: boolean;
}

export interface RiotEvent {
  EventID: number;
  EventName: string;
  EventTime: number;
  KillStreak?: number;
  KillerName?: string;
  Result?: string;
  [k: string]: unknown;
}

export interface RiotGameData {
  gameMode: string;
  gameTime: number; // sekundy (float)
  mapName?: string;
  mapNumber?: number;
  mapTerrain?: string;
}

export interface AllGameData {
  allPlayers: RiotPlayer[];
  events: { Events: RiotEvent[] };
  gameData: RiotGameData;
}

/**
 * Final live snapshot (workflow §16) — poslední validní stav z Live API.
 * Po vytvoření se už NESMÍ měnit. Z něj vzniká ConfirmedGame.
 */
export interface FinalLiveSnapshot {
  capturedAt: string;
  durationSeconds: number;
  players: LivePlayerState[];
  teamKills: { BLUE: number; RED: number };
  teamGold: { BLUE: number | null; RED: number | null };
  firstBlood: FirstBloodInfo | null;
}

/** Normalizovaný stav jednoho hráče z Live dat. */
export interface LivePlayerState {
  name: string;
  side: Side;
  championName: string;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number | null;
  vision: number;
  pentakills: number;
  items: number[];
}

// ---------------------------------------------------------------------------
// Průběžný live transport (LeagueBroadcast → outbox → budoucí Supabase ingest)
// ---------------------------------------------------------------------------

export type LiveTransportSource = "league-broadcast" | "riot-live-api" | "mock";
export type LiveTransportKind = "lifecycle" | "event" | "snapshot";

/** Stabilní obálka každé zprávy odesílané z Agenta. */
export interface LiveTransportEnvelope {
  schemaVersion: 1;
  eventId: string;
  localGameId: string;
  sequence: number;
  kind: LiveTransportKind;
  type: string;
  source: LiveTransportSource;
  capturedAt: string;
  gameTime: number | null;
  payload: unknown;
}

/** Normalizovaný WebSocket snapshot nezávislý na datových třídách BlueBottle. */
export interface BroadcastGameSnapshot {
  capturedAt: string;
  gameTime: number;
  players: LivePlayerState[];
  teamKills: { BLUE: number; RED: number };
  teamGold: { BLUE: number | null; RED: number | null };
  patch: string | null;
}

export interface BroadcastGameEvent {
  type: "champion.kill" | "player.update" | "objective" | "team.update";
  capturedAt: string;
  gameTime: number | null;
  payload: Record<string, unknown>;
}

export interface LiveDeliveryStatus {
  mode: "local-only" | "remote";
  configured: boolean;
  pending: number;
  delivered: number;
  failed: number;
  lastDeliveredAt: string | null;
  lastError: string | null;
}
