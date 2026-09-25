import type { ingameFrontendData } from "@bluebottle_gg/league-broadcast-client";

/**
 * Diagnostika damage z LeagueBroadcastu (0.1.16).
 *
 * Riot Live Client API damage nemá vůbec. LeagueBroadcast ho má v několika
 * volitelných polích stavu (damage graf po hráčích, složení damage, tok
 * damage mezi hráči…), ale zatím není ověřené, kdy je plní — nejspíš jen
 * když je v něm zapnutý odpovídající grafický prvek. Tenhle modul z každého
 * stavu vytáhne, co z damage přišlo, v podobě vhodné pro záznam do
 * `lb_damage.jsonl`. Nic dalšího v Agentovi na tom zatím nezávisí.
 */

export const DAMAGE_FIELDS = [
  "damageGraph",
  "teamfightDamageOverview",
  "damageComposition",
  "damageFlow",
  "damageRecap",
  "damageSplit",
] as const;

export type DamageField = (typeof DAMAGE_FIELDS)[number];

export interface DamageProbe {
  gameTime: number;
  /** Pole, která v tomhle stavu přišla neprázdná. */
  fields: DamageField[];
  /** Zkrácený obsah: jen damage, bez ikon, schopností a itemů. */
  sample: Partial<Record<DamageField, unknown>>;
}

function playerDamage(entry: {
  name?: string;
  displayName?: string;
  champion?: { name?: string };
  team?: number;
  role?: string;
  totalDamageDealt?: number;
  damageByType?: Record<string, number>;
}) {
  return {
    name: entry.displayName || entry.name,
    champion: entry.champion?.name,
    team: entry.team,
    role: entry.role,
    total: entry.totalDamageDealt,
    byType: entry.damageByType,
  };
}

/** Vrátí damage z jednoho stavu LeagueBroadcastu, nebo null, když žádný nepřišel. */
export function damageProbe(data: ingameFrontendData): DamageProbe | null {
  const sample: DamageProbe["sample"] = {};

  if (data.damageGraph?.damageDealt?.length) {
    sample.damageGraph = data.damageGraph.damageDealt.map(playerDamage);
  }
  if (data.teamfightDamageOverview?.damageDealt?.length) {
    sample.teamfightDamageOverview = data.teamfightDamageOverview.damageDealt.map(playerDamage);
  }
  if (data.damageComposition?.teams?.length) {
    sample.damageComposition = data.damageComposition.teams.map((team) => ({
      team: team.team,
      total: team.total,
      physical: team.physical,
      magic: team.magic,
      trueDamage: team.trueDamage,
      players: (team.players ?? []).map((player) => ({
        name: player.displayName || player.name,
        champion: player.champion?.name,
        total: player.total,
        physical: player.physical,
        magic: player.magic,
        trueDamage: player.trueDamage,
      })),
    }));
  }
  if (data.damageFlow?.nodes?.length) {
    sample.damageFlow = {
      startTime: data.damageFlow.startTime,
      endTime: data.damageFlow.endTime,
      nodes: data.damageFlow.nodes.map((node) => ({
        name: node.displayName || node.name,
        champion: node.champion?.name,
        team: node.team,
        dealt: node.totalDamageDealt,
        received: node.totalDamageReceived,
      })),
      edges: data.damageFlow.edges?.length ?? 0,
    };
  }
  // Rekapitulace jedné smrti a rozpad damage jednoho hráče: jen kdo a kolik.
  if (data.damageRecap) {
    sample.damageRecap = {
      victim: data.damageRecap.victimDisplayName || data.damageRecap.victimName,
      deathTime: data.damageRecap.deathTime,
      totalDamageReceived: data.damageRecap.totalDamageReceived,
      sources: data.damageRecap.entries?.length ?? 0,
    };
  }
  if (data.damageSplit) {
    sample.damageSplit = {
      source: data.damageSplit.sourceDisplayName || data.damageSplit.sourceName,
      totalDamageDealt: data.damageSplit.totalDamageDealt,
      targets: data.damageSplit.targets?.length ?? 0,
    };
  }

  const fields = DAMAGE_FIELDS.filter((field) => field in sample);
  if (fields.length === 0) return null;
  return { gameTime: Math.max(0, Math.round(data.gameTime ?? 0)), fields, sample };
}
