import type {
  ConfirmedGame,
  ConfirmedPlayer,
  ConfirmedTeam,
  FinalLiveSnapshot,
  GameMeta,
  GoldSample,
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
 * Rozdíly goldu hráčů jsou proti protivníkovi na stejné roli, tedy se
 * stejným `slot` na druhé straně. V 10. a 15. minutě se berou z posledního
 * vzorku goldu, který v tu chvíli existoval.
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
      items: p.items,
      slot,
      opponentChampion: opponent?.championName ?? null,
      goldDiff: p.gold !== null && opponent?.gold != null ? p.gold - opponent.gold : null,
      goldDiffAt10: slot === null ? null : laneGoldDiffAt(goldTimeline, 600, p.side, slot),
      goldDiffAt15: slot === null ? null : laneGoldDiffAt(goldTimeline, 900, p.side, slot),
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
    objectiveTimeline: objectives.timeline.map((kill) => ({ ...kill, team: teamNameOf(kill.side) })),
  };
}

/**
 * Rozdíl goldu hráče proti protivníkovi na stejné roli v daném herním čase.
 * Bere poslední vzorek nejpozději v tom čase a nejdřív minutu před ním —
 * starší vzorek (třeba když Agent naběhl až uprostřed hry) by nic neříkal.
 */
export function laneGoldDiffAt(timeline: GoldSample[], gameTime: number, side: Side, slot: number): number | null {
  const sample = [...timeline].reverse().find((s) => s.gameTime <= gameTime && s.gameTime >= gameTime - 60);
  if (!sample) return null;
  const own = sample.players.find((p) => p.side === side && p.slot === slot);
  const enemy = sample.players.find((p) => p.side !== side && p.slot === slot);
  return own && enemy ? own.gold - enemy.gold : null;
}
