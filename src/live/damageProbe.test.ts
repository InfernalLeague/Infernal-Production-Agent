import assert from "node:assert/strict";
import test from "node:test";
import type { ingameFrontendData } from "@bluebottle_gg/league-broadcast-client";
import { damageProbe } from "./damageProbe.js";

test("stav bez damage polí nevrátí nic", () => {
  assert.equal(damageProbe({ gameTime: 600 } as ingameFrontendData), null);
});

test("damage graf a složení damage se zkrátí na hráče a čísla", () => {
  const probe = damageProbe({
    gameTime: 912.4,
    damageGraph: {
      damageDealt: [
        {
          name: "p1",
          displayName: "Zed hráč",
          champion: { name: "Zed" },
          team: 0,
          role: "TOP",
          totalDamageDealt: 18250,
          damageByType: { physical: 17000, true: 1250 },
          abilities: [{}],
          activeItems: [{}],
        },
      ],
    },
    damageComposition: {
      teams: [{ team: 0, total: 50000, physical: 30000, magic: 15000, trueDamage: 5000, players: [] }],
    },
  } as unknown as ingameFrontendData);

  assert.ok(probe);
  assert.deepEqual(probe.fields, ["damageGraph", "damageComposition"]);
  assert.equal(probe.gameTime, 912);
  assert.deepEqual(probe.sample.damageGraph, [
    { name: "Zed hráč", champion: "Zed", team: 0, role: "TOP", total: 18250, byType: { physical: 17000, true: 1250 } },
  ]);
});
