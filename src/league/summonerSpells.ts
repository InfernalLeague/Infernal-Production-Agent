import type { AllGameData, RiotPlayer, Side } from "../types.js";
import { championKey } from "./objectives.js";

/**
 * Summoner spelly hráčů z Riot Live API.
 *
 * LeagueBroadcast je ve spodním scoreboardu nemá, Live API ano
 * (`summonerSpells.summonerSpellOne/Two`). Posílá se interní jméno spellu
 * z `rawDisplayName` („GeneratedTip_SummonerSpell_SummonerFlash_DisplayName“
 * → „SummonerFlash“), což je klíč v Data Dragonu; když chybí, jeho
 * zobrazované jméno („Flash“). Web si ikonu dohledá podle jednoho z nich.
 */
const RAW_NAME = /^GeneratedTip_SummonerSpell_(.+)_DisplayName$/;

function spellId(spell: { displayName?: string; rawDisplayName?: string } | undefined): string | null {
  if (!spell) return null;
  const raw = RAW_NAME.exec(spell.rawDisplayName ?? "")?.[1];
  return raw || spell.displayName?.trim() || null;
}

export function summonerSpellsOf(player: RiotPlayer): string[] {
  const spells = player.summonerSpells;
  return [spellId(spells?.summonerSpellOne), spellId(spells?.summonerSpellTwo)].filter(
    (spell): spell is string => Boolean(spell),
  );
}

/** Spelly všech hráčů hry podle strany a championa (klíč jako u pentakillů). */
export function summonerSpellsByChampion(data: AllGameData): Map<string, string[]> {
  const bySide = (team: RiotPlayer["team"]): Side => (team === "ORDER" ? "BLUE" : "RED");
  const result = new Map<string, string[]>();
  for (const player of data.allPlayers ?? []) {
    const spells = summonerSpellsOf(player);
    if (spells.length > 0) result.set(championKey(bySide(player.team), player.championName), spells);
  }
  return result;
}
