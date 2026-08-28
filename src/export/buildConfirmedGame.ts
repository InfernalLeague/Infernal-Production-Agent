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
 * Damage / gold_per_minute jsou zatím null (přijdou z dalšího zdroje).
 * Gold je dostupný z LeagueBroadcastu, při Riot API fallbacku zůstává null.
 * Vision a ostatní dostupné statistiky mají zdroj "live".
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
    gold: snapshot.teamGold[side],
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
    gold: p.gold,
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
      gold: p.gold === null ? null : "live",
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
