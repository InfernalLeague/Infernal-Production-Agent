import type {
  ingameFrontendData,
  killFeedEvent,
  playerUpdateEvent,
  ingameObjectiveEvent,
  teamUpdateResults,
  simpleChampionData,
} from "@bluebottle_gg/league-broadcast-client";
import type { BroadcastGameEvent, BroadcastGameSnapshot, LivePlayerState, Side } from "../types.js";

function roundOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function sideAt(index: number): Side {
  return index === 0 ? "BLUE" : "RED";
}

/** Převod BlueBottle snapshotu na stabilní kontrakt Agenta. */
export function normalizeBroadcastSnapshot(data: ingameFrontendData): BroadcastGameSnapshot | null {
  const bottom = data.scoreboardBottom;
  if (!bottom?.teams?.length) return null;

  const players: LivePlayerState[] = [];
  bottom.teams.slice(0, 2).forEach((team, teamIndex) => {
    const side = sideAt(teamIndex);
    (team.players ?? []).forEach((player, slot) => {
      players.push({
        name: player.displayName?.trim() || player.name?.trim() || player.champion?.name || "Unknown",
        side,
        championName: player.champion?.name ?? player.champion?.alias ?? "Unknown",
        level: player.level ?? 0,
        kills: player.kills ?? 0,
        deaths: player.deaths ?? 0,
        assists: player.assists ?? 0,
        cs: player.creepScore ?? 0,
        // Celé číslo: LeagueBroadcast posílá gold s desetinami (13293.067).
        gold: roundOrNull(player.totalGold ?? player.gold),
        vision: Math.round(player.visionScore ?? 0),
        pentakills: 0,
        soloKills: 0, // LeagueBroadcast je nezná; doplní GameSession z Live API
        items: (player.items ?? [])
          .filter((item) => item.id > 0 && item.count !== 0)
          .sort((a, b) => a.slot - b.slot)
          .map((item) => item.id),
        slot,
      });
    });
  });

  const sums = { BLUE: 0, RED: 0 };
  for (const player of players) sums[player.side] += player.kills;
  const scoreboard = data.scoreboard?.teams ?? [];

  return {
    capturedAt: new Date().toISOString(),
    gameTime: Math.max(0, data.gameTime ?? bottom.gameTime ?? 0),
    players,
    teamKills: {
      BLUE: scoreboard[0]?.kills ?? sums.BLUE,
      RED: scoreboard[1]?.kills ?? sums.RED,
    },
    teamGold: {
      BLUE: roundOrNull(scoreboard[0]?.gold),
      RED: roundOrNull(scoreboard[1]?.gold),
    },
    patch: data.patch ?? data.gameVersion ?? null,
  };
}

function playerForChampion(snapshot: BroadcastGameSnapshot | null, champion?: simpleChampionData): string | null {
  if (!champion || !snapshot) return null;
  const key = (champion.alias || champion.name || "").toLowerCase();
  return snapshot.players.find((p) =>
    p.championName.toLowerCase() === key || p.championName.toLowerCase().replace(/[^a-z0-9]/g, "") === key.replace(/[^a-z0-9]/g, ""),
  )?.name ?? null;
}

export function normalizeKillEvent(event: killFeedEvent, snapshot: BroadcastGameSnapshot | null, gameTime: number | null): BroadcastGameEvent {
  return {
    type: "champion.kill",
    capturedAt: new Date().toISOString(),
    gameTime,
    payload: {
      teamId: event.ingameTeamId,
      killer: event.killer ? {
        playerName: playerForChampion(snapshot, event.killer),
        championId: event.killer.id,
        championName: event.killer.name,
      } : null,
      victim: {
        playerName: playerForChampion(snapshot, event.victim),
        championId: event.victim.id,
        championName: event.victim.name,
      },
      assisters: (event.assisters ?? []).map((champion) => ({
        playerName: playerForChampion(snapshot, champion),
        championId: champion.id,
        championName: champion.name,
      })),
    },
  };
}

export function normalizePlayerEvent(event: playerUpdateEvent, gameTime: number | null): BroadcastGameEvent {
  return {
    type: "player.update",
    capturedAt: new Date().toISOString(),
    gameTime,
    payload: {
      playerKey: event.guid,
      playerName: event.playerNameAndTagLine,
      kills: event.kills,
      deaths: event.deaths,
      assists: event.assists,
      boughtItems: (event.boughtItems ?? []).map((item) => ({ id: item.id, slot: item.slot, count: item.count })),
      removedItems: (event.soldOrConsumedItems ?? []).map((item) => ({ id: item.id, slot: item.slot, count: item.count })),
      levels: event.levelUp ?? [],
    },
  };
}

export function normalizeObjectiveEvent(event: ingameObjectiveEvent, gameTime: number | null): BroadcastGameEvent {
  return {
    type: "objective",
    capturedAt: new Date().toISOString(),
    gameTime,
    payload: { ...event },
  };
}

export function normalizeTeamEvent(event: teamUpdateResults, gameTime: number | null): BroadcastGameEvent {
  return {
    type: "team.update",
    capturedAt: new Date().toISOString(),
    gameTime,
    payload: { ...event },
  };
}
