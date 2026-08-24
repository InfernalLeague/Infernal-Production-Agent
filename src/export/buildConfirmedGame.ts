import type {
  ConfirmedGame,
  ConfirmedPlayer,
  ConfirmedTeam,
  Draft,
  FinalLiveSnapshot,
  GameMeta,
  Side,
} from "../types.js";

/**
 * Sestaví finální `ConfirmedGame` objekt (source of truth) z final live snapshotu.
 *
 * Fáze 1A: máme jen live data → damage / gold / gold_per_minute jsou null
 * (přijdou až ze screenshotu ve Fázi 1B). Vision je live-only (§23).
 * Ostatní statistiky mají zdroj "live". Team gold zatím null (§22).
 */
export function buildConfirmedGame(
  meta: GameMeta,
  snapshot: FinalLiveSnapshot,
  winner: string | null,
  draft: Draft | null = null,
): ConfirmedGame {
  const teamNameOf = (side: Side): string =>
    side === meta.team1Side ? meta.team1 : meta.team2;

  const fb = snapshot.firstBlood;

  const teams: ConfirmedTeam[] = (["BLUE", "RED"] as Side[]).map((side) => ({
    name: teamNameOf(side),
    side,
    kills: snapshot.teamKills[side],
    gold: null, // až ze screenshotu (§22)
  }));

  const players: ConfirmedPlayer[] = snapshot.players.map((p) => ({
    name: p.name,
    team: teamNameOf(p.side),
    side: p.side,
    championName: p.championName,
    level: p.level,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    cs: p.cs,
    vision: p.vision,
    damage: null,
    gold: null,
    goldPerMinute: null,
    pentakills: p.pentakills,
    items: p.items,
    sources: {
      kills: "live",
      deaths: "live",
      assists: "live",
      cs: "live",
      vision: "live",
      damage: null,
      gold: null,
      goldPerMinute: null,
    },
  }));

  return {
    game: {
      localGameId: meta.localGameId,
      team1: meta.team1,
      team2: meta.team2,
      gameNumber: meta.gameNumber,
      seriesFormat: meta.seriesFormat,
      production: meta.production,
      durationSeconds: snapshot.durationSeconds,
      winner,
      firstBloodPlayer: fb ? fb.playerName : null,
      firstBloodTeam: fb ? teamNameOf(fb.side) : null,
      createdAt: meta.createdAt,
      confirmedAt: new Date().toISOString(),
      status: "CONFIRMED",
    },
    teams,
    players,
    draft,
  };
}
