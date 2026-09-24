import type {
  ConfirmedGame,
  ConfirmedPlayer,
  ConfirmedTeam,
  FinalLiveSnapshot,
  GameMeta,
  Side,
} from "../types.js";
import { emptyObjectives } from "../league/objectives.js";

/**
 * Sestaví finální `ConfirmedGame` objekt (source of truth) z final live snapshotu.
 *
 * Damage / gold_per_minute jsou zatím null (přijdou z dalšího zdroje).
 * Gold je dostupný z LeagueBroadcastu, při Riot API fallbacku zůstává null.
 * Vision a ostatní dostupné statistiky mají zdroj "live".
 *
 * Rozdíl goldu hráče je proti protivníkovi na stejné roli (stejný `slot`
 * na druhé straně) a bere se jen ve 14. minutě.
 */
export function buildConfirmedGame(
  meta: GameMeta,
  snapshot: FinalLiveSnapshot,
  winner: string | null,
  winnerSource: "auto" | "manual" | null = null,
): ConfirmedGame {
  const teamNameOf = (side: Side): string =>
    side === meta.team1Side ? meta.team1 : meta.team2;
  const other = (side: Side): Side => (side === "BLUE" ? "RED" : "BLUE");

  const fb = snapshot.firstBlood;
  // Recovery snapshot ze starší verze objektivy ani gold v čase nemá.
  const objectives = snapshot.objectives ?? emptyObjectives();
  const goldTimeline = snapshot.goldTimeline ?? [];
  const laneGoldAt14 = snapshot.laneGoldAt14 ?? null;
  const teamOrNull = (side: Side | null): string | null => (side ? teamNameOf(side) : null);

  const teams: ConfirmedTeam[] = (["BLUE", "RED"] as Side[]).map((side) => {
    const own = snapshot.teamGold[side];
    const enemy = snapshot.teamGold[other(side)];
    return {
      name: teamNameOf(side),
      side,
      kills: snapshot.teamKills[side],
      gold: own,
      goldDiff: own !== null && enemy !== null ? own - enemy : null,
      objectives: objectives.teams[side],
    };
  });

  const players: ConfirmedPlayer[] = snapshot.players.map((p) => {
    const slot = p.slot ?? null;
    const opponent =
      slot === null ? null : snapshot.players.find((o) => o.side === other(p.side) && o.slot === slot) ?? null;
    return {
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
      soloKills: p.soloKills ?? 0,
      items: p.items,
      slot,
      opponentChampion: opponent?.championName ?? null,
      goldDiffAt14:
        laneGoldAt14?.players.find((lane) => lane.side === p.side && lane.slot === slot)?.goldDiff ?? null,
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
    };
  });

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
      winnerSource: winner ? winnerSource : null,
      firstBloodPlayer: fb ? fb.playerName : null,
      firstBloodTeam: fb ? teamNameOf(fb.side) : null,
      firstDragonTeam: teamOrNull(objectives.firstDragon),
      firstBaronTeam: teamOrNull(objectives.firstBaron),
      firstTowerTeam: teamOrNull(objectives.firstTower),
      createdAt: meta.createdAt,
      confirmedAt: new Date().toISOString(),
      status: "CONFIRMED",
    },
    teams,
    players,
    goldTimeline,
    laneGoldAt14,
    objectiveTimeline: objectives.timeline.map((kill) => ({ ...kill, team: teamNameOf(kill.side) })),
  };
}

