import type { AllGameData, FirstBloodInfo, LivePlayerState, RiotPlayer, Side } from "../types.js";
import { toItemSlots } from "./itemSlots.js";
import { summonerSpellsOf } from "./summonerSpells.js";

/** ORDER = modrá strana, CHAOS = červená (Live Client API konvence). */
export function sideOf(team: RiotPlayer["team"]): Side {
  return team === "ORDER" ? "BLUE" : "RED";
}

/** Jméno hráče: preferuj Riot ID game name, pak summoner name, pak Riot ID. */
export function playerName(p: RiotPlayer): string {
  return (p.riotIdGameName || p.summonerName || p.riotId || p.championName || "Unknown").trim();
}

/**
 * Spočítá pentakilly každého hráče z (kumulativního) seznamu eventů (workflow §14).
 * Multikill s KillStreak >= 5 = pentakill. Vrací mapu jméno → počet.
 */
export function pentakillsByPlayer(data: AllGameData): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of data.events?.Events ?? []) {
    if (e.EventName === "Multikill" && (e.KillStreak ?? 0) >= 5 && e.KillerName) {
      out.set(e.KillerName, (out.get(e.KillerName) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * Detekuje first blood = první zabití šampiona ve hře (nejdřívější `ChampionKill`
 * event). Vrací jméno zabijáka a jeho stranu, nebo null, dokud první krev nepadla.
 *
 * Vychází z kumulativního event streamu Live API. KillerName (jméno hráče) mapujeme
 * na stranu přes allPlayers; kill exekucí věží/minionů (neznámý KillerName) ignorujeme.
 */
export function firstBlood(data: AllGameData): FirstBloodInfo | null {
  const kills = (data.events?.Events ?? []).filter(
    (e) => e.EventName === "ChampionKill" && typeof e.KillerName === "string" && e.KillerName,
  );
  if (kills.length === 0) return null;

  const first = kills.reduce((a, b) => (b.EventTime < a.EventTime ? b : a));
  const killer = String(first.KillerName);

  const player = (data.allPlayers ?? []).find(
    (p) => playerName(p) === killer || p.championName === killer,
  );
  if (!player) return null; // KillerName nesedí na žádného hráče → nezapočítáme

  return { playerName: playerName(player), side: sideOf(player.team) };
}

const POSITION_SLOTS: Record<string, number> = { TOP: 0, JUNGLE: 1, MIDDLE: 2, BOTTOM: 3, UTILITY: 4 };

/**
 * Pozice hráče v týmu (0 top … 4 support). Live API ji posílá v `position`;
 * když u některého hráče strany chybí nebo se opakuje, platí pořadí
 * v `allPlayers`, jinak by dva hráči dostali stejnou roli.
 */
function playerSlots(players: RiotPlayer[]): number[] {
  const bySide = { BLUE: [] as number[], RED: [] as number[] };
  players.forEach((p, i) => bySide[sideOf(p.team)].push(i));

  const slots: number[] = [];
  for (const indexes of Object.values(bySide)) {
    const positions = indexes.map((i) => POSITION_SLOTS[(players[i].position ?? "").toUpperCase()]);
    const valid = positions.every((slot) => slot !== undefined) && new Set(positions).size === positions.length;
    indexes.forEach((i, order) => (slots[i] = valid ? positions[order] : order));
  }
  return slots;
}

/** Normalizuje surová Live data na seznam interních stavů hráčů. */
export function normalizePlayers(data: AllGameData): LivePlayerState[] {
  const pentas = pentakillsByPlayer(data);
  const slots = playerSlots(data.allPlayers ?? []);
  return (data.allPlayers ?? []).map((p, index) => {
    const name = playerName(p);
    const side = sideOf(p.team);
    return {
      name,
      side,
      championName: p.championName,
      level: p.level,
      kills: p.scores.kills,
      deaths: p.scores.deaths,
      assists: p.scores.assists,
      cs: p.scores.creepScore,
      gold: null, // Riot Live Client API osobní gold neposkytuje
      vision: Math.round(p.scores.wardScore), // wardScore = Vision Score (§23)
      pentakills: pentas.get(name) ?? 0,
      soloKills: 0, // doplní GameSession z event streamu
      items: (p.items ?? []).map((it) => it.itemID),
      itemSlots: toItemSlots((p.items ?? []).map((it) => ({ id: it.itemID, slot: it.slot, count: it.count }))),
      summonerSpells: summonerSpellsOf(p),
      slot: slots[index],
    };
  });
}

/** Team kills = součet killů hráčů dané strany (workflow §11). */
export function teamKills(players: LivePlayerState[]): { BLUE: number; RED: number } {
  const acc = { BLUE: 0, RED: 0 };
  for (const p of players) acc[p.side] += p.kills;
  return acc;
}
