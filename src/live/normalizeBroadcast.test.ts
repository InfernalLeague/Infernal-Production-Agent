import assert from "node:assert/strict";
import test from "node:test";
import type { ingameFrontendData, killFeedEvent } from "@bluebottle_gg/league-broadcast-client";
import { normalizeBroadcastSnapshot, normalizeKillEvent } from "./normalizeBroadcast.js";

test("normalizuje KDA, CS, gold, itemy a herní čas z LeagueBroadcast snapshotu", () => {
  const raw = {
    gameTime: 2128.42,
    gameVersion: "16.17",
    patch: "16.17",
    scoreboard: { teams: [{ kills: 12, gold: 55210 }, { kills: 9, gold: 50110 }] },
    scoreboardBottom: {
      gameTime: 2128.42,
      teams: [
        {
          players: [{
            displayName: "Blue ADC",
            name: "blue#EUW",
            champion: { id: 222, name: "Jinx", alias: "Jinx" },
            kills: 6, deaths: 2, assists: 8, level: 18,
            gold: 1200, totalGold: 14500, creepScore: 311, visionScore: 18,
            items: [{ id: 3006, slot: 1, count: 1 }, { id: 3031, slot: 0, count: 1 }],
          }],
        },
        { players: [] },
      ],
    },
  } as unknown as ingameFrontendData;

  const snapshot = normalizeBroadcastSnapshot(raw);
  assert.ok(snapshot);
  assert.equal(snapshot.gameTime, 2128.42);
  assert.deepEqual(snapshot.teamGold, { BLUE: 55210, RED: 50110 });
  assert.deepEqual(snapshot.teamKills, { BLUE: 12, RED: 9 });
  assert.deepEqual(snapshot.players[0], {
    name: "Blue ADC",
    side: "BLUE",
    championName: "Jinx",
    level: 18,
    kills: 6,
    deaths: 2,
    assists: 8,
    cs: 311,
    gold: 14500,
    vision: 18,
    pentakills: 0,
    soloKills: 0,
    items: [3031, 3006],
    slot: 0,
  });
});

test("kill event doplní jména hráčů podle šampionů", () => {
  const snapshot = {
    capturedAt: new Date().toISOString(), gameTime: 90, patch: null,
    teamKills: { BLUE: 1, RED: 0 }, teamGold: { BLUE: null, RED: null },
    players: [
      { name: "Blue ADC", side: "BLUE" as const, championName: "Jinx", level: 4, kills: 1, deaths: 0, assists: 0, cs: 25, gold: 1800, vision: 1, pentakills: 0, soloKills: 0, items: [] },
      { name: "Red ADC", side: "RED" as const, championName: "Kai'Sa", level: 4, kills: 0, deaths: 1, assists: 0, cs: 22, gold: 1500, vision: 1, pentakills: 0, soloKills: 0, items: [] },
    ],
  };
  const event = {
    ingameTeamId: 1,
    killer: { id: 222, name: "Jinx", alias: "Jinx" },
    victim: { id: 145, name: "Kai'Sa", alias: "Kaisa" },
    assisters: [],
  } as unknown as killFeedEvent;

  const normalized = normalizeKillEvent(event, snapshot, 90.5);
  const payload = normalized.payload as { killer: { playerName: string }; victim: { playerName: string } };
  assert.equal(payload.killer.playerName, "Blue ADC");
  assert.equal(payload.victim.playerName, "Red ADC");
  assert.equal(normalized.gameTime, 90.5);
});
