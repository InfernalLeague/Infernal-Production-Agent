import type { AllGameData, FirstBloodInfo, LivePlayerState, RiotPlayer, Side } from "../types.js";

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

/** Normalizuje surová Live data na seznam interních stavů hráčů. */
export function normalizePlayers(data: AllGameData): LivePlayerState[] {
  const pentas = pentakillsByPlayer(data);
  const slots = { BLUE: 0, RED: 0 };
  return (data.allPlayers ?? []).map((p) => {
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
      items: (p.items ?? []).map((it) => it.itemID),
      slot: slots[side]++,
    };
  });
}

/** Team kills = součet killů hráčů dané strany (workflow §11). */
export function teamKills(players: LivePlayerState[]): { BLUE: number; RED: number } {
  const acc = { BLUE: 0, RED: 0 };
  for (const p of players) acc[p.side] += p.kills;
  return acc;
}
