import assert from "node:assert/strict";
import test from "node:test";
import type { AllGameData, RiotPlayer } from "../types.js";
import { summonerSpellsByChampion, summonerSpellsOf } from "./summonerSpells.js";

const player = (overrides: Partial<RiotPlayer>): RiotPlayer =>
  ({ championName: "Zed", team: "ORDER", level: 1, scores: {}, items: [], ...overrides }) as RiotPlayer;

test("spell se bere z interního jména, jinak ze zobrazovaného", () => {
  assert.deepEqual(
    summonerSpellsOf(
      player({
        summonerSpells: {
          summonerSpellOne: {
            displayName: "Flash",
            rawDisplayName: "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName",
          },
          summonerSpellTwo: {
            displayName: "Unleashed Teleport",
            rawDisplayName: "GeneratedTip_SummonerSpell_S12_SummonerTeleportUpgrade_DisplayName",
          },
        },
      }),
    ),
    ["SummonerFlash", "S12_SummonerTeleportUpgrade"],
  );
  assert.deepEqual(summonerSpellsOf(player({ summonerSpells: { summonerSpellOne: { displayName: "Ignite" } } })), [
    "Ignite",
  ]);
  assert.deepEqual(summonerSpellsOf(player({})), []);
});

test("spelly hráčů jdou podle strany a championa", () => {
  const data = {
    allPlayers: [
      player({
        championName: "Nami",
        team: "CHAOS",
        summonerSpells: {
          summonerSpellOne: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" },
          summonerSpellTwo: { rawDisplayName: "GeneratedTip_SummonerSpell_SummonerExhaust_DisplayName" },
        },
      }),
    ],
  } as unknown as AllGameData;
  const spells = summonerSpellsByChampion(data);
  assert.equal(spells.size, 1);
  assert.deepEqual([...spells.values()][0], ["SummonerFlash", "SummonerExhaust"]);
});
