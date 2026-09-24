import assert from "node:assert/strict";
import test from "node:test";
import type { AllGameData, RiotEvent, RiotPlayer } from "../types.js";
import { GameSession } from "../core/GameSession.js";
import { championKey, objectivesFromEvents, pentakillsByChampion } from "./objectives.js";

function player(name: string, championName: string, team: "ORDER" | "CHAOS"): RiotPlayer {
  return {
    championName,
    riotIdGameName: name,
    riotId: `${name}#EUW`,
    team,
    level: 12,
    scores: { kills: 0, deaths: 0, assists: 0, creepScore: 0, wardScore: 0 },
    items: [],
  };
}

const players = [
  player("Blue Jungle", "Vi", "ORDER"),
  player("Blue ADC", "Jinx", "ORDER"),
  player("Red Jungle", "Lee Sin", "CHAOS"),
  player("Red ADC", "Kai'Sa", "CHAOS"),
];

function game(events: RiotEvent[]): AllGameData {
  return { allPlayers: players, events: { Events: events }, gameData: { gameMode: "CLASSIC", gameTime: 1800 } };
}

test("sčítá draky podle typu, barony, heraldy, voidgruby a první objektivy", () => {
  const objectives = objectivesFromEvents(game([
    { EventID: 1, EventName: "HordeKill", EventTime: 300, KillerName: "Red Jungle", Stolen: "False" },
    { EventID: 2, EventName: "DragonKill", EventTime: 360, DragonType: "Fire", KillerName: "Blue Jungle", Stolen: "False" },
    { EventID: 3, EventName: "HeraldKill", EventTime: 800, KillerName: "Red Jungle", Stolen: "False" },
    { EventID: 4, EventName: "DragonKill", EventTime: 900, DragonType: "Hextech", KillerName: "Red Jungle", Stolen: "True" },
    { EventID: 5, EventName: "BaronKill", EventTime: 1500, KillerName: "Red ADC", Stolen: "False" },
    { EventID: 6, EventName: "AtakhanKill", EventTime: 1300, KillerName: "Blue ADC", Stolen: "False" },
  ]));

  assert.equal(objectives.teams.BLUE.dragons, 1);
  assert.equal(objectives.teams.BLUE.dragonTypes.fire, 1);
  assert.equal(objectives.teams.RED.dragonTypes.hextech, 1);
  assert.equal(objectives.teams.RED.voidgrubs, 1);
  assert.equal(objectives.teams.RED.heralds, 1);
  assert.equal(objectives.teams.RED.barons, 1);
  assert.equal(objectives.teams.BLUE.atakhans, 1);
  assert.equal(objectives.firstDragon, "BLUE");
  assert.equal(objectives.firstBaron, "RED");
  assert.equal(objectives.timeline.find((kill) => kill.eventId === 4)?.stolen, true);
  // Timeline je seřazená podle herního času, ne podle pořadí v poli.
  assert.deepEqual(objectives.timeline.map((kill) => kill.eventId), [1, 2, 3, 4, 6, 5]);
});

test("věže a inhibitory se počítají straně, která budovu zbourala, i když zabil minion", () => {
  const objectives = objectivesFromEvents(game([
    { EventID: 1, EventName: "TurretKilled", EventTime: 600, TurretKilled: "Turret_T1_L_03_A", KillerName: "Minion_T2L0S0N0" },
    { EventID: 2, EventName: "TurretKilled", EventTime: 700, TurretKilled: "Turret_T2_R_03_A", KillerName: "Blue ADC" },
    { EventID: 3, EventName: "InhibKilled", EventTime: 1400, InhibKilled: "Barracks_T1_C1", KillerName: "Red ADC" },
  ]));

  assert.equal(objectives.teams.RED.towers, 1);
  assert.equal(objectives.teams.BLUE.towers, 1);
  assert.equal(objectives.teams.RED.inhibitors, 1);
  assert.equal(objectives.firstTower, "RED");
});

test("čtvrtý elementální drak určí dračí duši, elder se do ní nepočítá", () => {
  const dragons = ["Fire", "Elder", "Ocean", "Chemtech", "Chemtech"].map((type, index) => ({
    EventID: index + 1,
    EventName: "DragonKill",
    EventTime: 300 + index * 300,
    DragonType: type === "Ocean" ? "Water" : type,
    KillerName: "Blue Jungle",
    Stolen: "False",
  }));
  const objectives = objectivesFromEvents(game(dragons));

  assert.equal(objectives.teams.BLUE.dragons, 5);
  assert.equal(objectives.teams.BLUE.dragonTypes.elder, 1);
  assert.equal(objectives.teams.BLUE.dragonSoul, "chemtech");
});

test("pentakill se páruje přes championa, takže sedí i na jména z LeagueBroadcastu", () => {
  const data = game([{ EventID: 1, EventName: "Multikill", EventTime: 1600, KillStreak: 5, KillerName: "Red ADC" }]);
  assert.equal(pentakillsByChampion(data).get(championKey("RED", "Kai'Sa")), 1);

  const session = new GameSession(
    {
      localGameId: "TEST-1",
      team1: "Blue",
      team2: "Red",
      gameNumber: 1,
      seriesFormat: "BO1",
      team1Side: "BLUE",
      createdAt: new Date().toISOString(),
      status: "WAITING_FOR_GAME",
    },
    ".",
  );
  // LeagueBroadcast píše jméno jinak než Live API a pentakilly nezná.
  session.applyBroadcast({
    capturedAt: new Date().toISOString(),
    gameTime: 1600,
    players: [{
      name: "RedADC#EUW", side: "RED", championName: "Kai'Sa", level: 16,
      kills: 9, deaths: 1, assists: 3, cs: 250, gold: 14000, vision: 20, pentakills: 0, items: [],
    }],
    teamKills: { BLUE: 3, RED: 9 },
    teamGold: { BLUE: null, RED: null },
    patch: null,
  });
  const { newObjectives } = session.applyLiveEvents(data);

  assert.equal(newObjectives.length, 0);
  assert.equal(session.currentLive?.players[0]?.pentakills, 1);
});

test("applyLiveEvents vrací jen objektivy, které přibyly od minula", () => {
  const session = new GameSession(
    {
      localGameId: "TEST-2",
      team1: "Blue",
      team2: "Red",
      gameNumber: 1,
      seriesFormat: "BO1",
      team1Side: "BLUE",
      createdAt: new Date().toISOString(),
      status: "WAITING_FOR_GAME",
    },
    ".",
  );
  const first: RiotEvent = { EventID: 1, EventName: "DragonKill", EventTime: 360, DragonType: "Air", KillerName: "Blue Jungle", Stolen: "False" };
  const second: RiotEvent = { EventID: 2, EventName: "BaronKill", EventTime: 1300, KillerName: "Red Jungle", Stolen: "False" };

  assert.equal(session.applyLiveEvents(game([first])).newObjectives.length, 1);
  assert.equal(session.applyLiveEvents(game([first])).newObjectives.length, 0);
  const next = session.applyLiveEvents(game([first, second])).newObjectives;
  assert.deepEqual(next.map((kill) => kill.kind), ["baron"]);
});

test("záloha z LeagueBroadcastu: draci s typem, grub, herald, věže a inhibitory podle týmu", () => {
  const session = new GameSession(
    {
      localGameId: "TEST-3",
      team1: "Blue",
      team2: "Red",
      gameNumber: 1,
      seriesFormat: "BO1",
      team1Side: "BLUE",
      createdAt: new Date().toISOString(),
      status: "WAITING_FOR_GAME",
    },
    ".",
  );
  const event = (type: "objective" | "team.update", gameTime: number, payload: Record<string, unknown>) =>
    session.applyBroadcastEvent({ type, capturedAt: new Date().toISOString(), gameTime, payload });

  // Tvar eventů podle zkušebního spectatu 24. 9. 2026.
  assert.equal(event("objective", 541, { objective: "DRAGON_WATER", eventType: "Kill", killer: "Blue Jungle#EUNE", team: 1 }).length, 1);
  event("objective", 700, { objective: "DRAGON_AIR", eventType: "Spawn", team: 1 });
  event("objective", 734, { objective: "GRUB", eventType: "Kill", killer: "Blue Jungle#EUNE", team: 1 });
  event("objective", 985, { objective: "HERALD", eventType: "Kill", killer: "Blue Jungle#EUNE", team: 1 });
  event("objective", 1500, { objective: "BARON", eventType: "Kill", killer: "Red Jungle#EUNE", team: 2 });
  event("team.update", 927, { teamId: 1, platesTaken: 0, turretsTaken: 1, inhibitorsTaken: 0 });
  event("team.update", 1140, { teamId: 2, platesTaken: 0, turretsTaken: 1, inhibitorsTaken: 0 });
  event("team.update", 1351, { teamId: 1, platesTaken: 0, turretsTaken: 0, inhibitorsTaken: 1 });

  const objectives = session.objectives();
  assert.equal(objectives.teams.BLUE.dragonTypes.water, 1);
  assert.equal(objectives.teams.BLUE.dragons, 1, "spawn se nepočítá");
  assert.equal(objectives.teams.BLUE.voidgrubs, 1);
  assert.equal(objectives.teams.BLUE.heralds, 1);
  assert.equal(objectives.teams.RED.barons, 1);
  assert.equal(objectives.teams.BLUE.towers, 1);
  assert.equal(objectives.teams.RED.towers, 1);
  assert.equal(objectives.teams.BLUE.inhibitors, 1);
  assert.equal(objectives.firstTower, "BLUE");

  // Jakmile objektivy hlásí Live API, má přednost a LeagueBroadcast se nepřičítá.
  session.applyLiveEvents(game([
    { EventID: 1, EventName: "DragonKill", EventTime: 541, DragonType: "Water", KillerName: "Blue Jungle", Stolen: "False" },
  ]));
  assert.equal(session.objectives().teams.BLUE.dragons, 1);
  assert.equal(session.objectives().teams.RED.barons, 0);
  assert.equal(event("objective", 1600, { objective: "DRAGON_ELDER", eventType: "Kill", team: 1 }).length, 0);
});

test("spectator: budovy jako Turret_TOrder_…/Inhib_TChaos_… z Live API, draci z LeagueBroadcastu, bez zdvojení", () => {
  const session = new GameSession(
    {
      localGameId: "TEST-4",
      team1: "Blue",
      team2: "Red",
      gameNumber: 1,
      seriesFormat: "BO1",
      team1Side: "BLUE",
      createdAt: new Date().toISOString(),
      status: "WAITING_FOR_GAME",
    },
    ".",
  );
  // Tvar eventů podle zkušebního spectatu 24. 9. 2026 (Ixtal vs Freljord).
  const riot: RiotEvent[] = [
    { EventID: 0, EventName: "GameStart", EventTime: 0 },
    { EventID: 9, EventName: "TurretKilled", EventTime: 644, KillerName: "Blue ADC", TurretKilled: "Turret_TChaos_L2_P3_2521511112_0", Assisters: [] },
    { EventID: 20, EventName: "TurretKilled", EventTime: 908, KillerName: "Red ADC", TurretKilled: "Turret_TOrder_L0_P3_3795288474_0", Assisters: [] },
    { EventID: 75, EventName: "InhibKilled", EventTime: 1751, KillerName: "Red ADC", InhibKilled: "Inhib_TOrder_L1_P1_2786523670_0", Assisters: [] },
    { EventID: 79, EventName: "TurretKilled", EventTime: 1768, KillerName: "Red ADC", TurretKilled: "Turret_TOrder_L1_P5_3625540808_0", Assisters: [] },
  ];
  session.applyLiveEvents(game(riot));
  const broadcast = (type: "objective" | "team.update", gameTime: number, payload: Record<string, unknown>) =>
    session.applyBroadcastEvent({ type, capturedAt: new Date().toISOString(), gameTime, payload });

  // Stejné věže hlásí i LeagueBroadcast — nesmí se přičíst ani poslat do streamu.
  assert.equal(broadcast("team.update", 908, { teamId: 2, platesTaken: 0, turretsTaken: 1, inhibitorsTaken: 0 }).length, 0);
  // Draka Live API ve spectatoru nehlásí, bere se z LeagueBroadcastu.
  assert.equal(broadcast("objective", 822, { objective: "DRAGON_AIR", eventType: "Kill", killer: "Red Jungle#EUNE", team: 2 }).length, 1);

  const objectives = session.objectives();
  assert.equal(objectives.teams.BLUE.towers, 1);
  assert.equal(objectives.teams.RED.towers, 2);
  assert.equal(objectives.teams.RED.inhibitors, 1);
  assert.equal(objectives.teams.RED.dragonTypes.air, 1);
  assert.equal(objectives.firstTower, "BLUE");

  // Vítěz: poslední zbouraná budova v závěru hry patří červeným.
  session.applyBroadcast({
    capturedAt: new Date().toISOString(), gameTime: 1782, players: [],
    teamKills: { BLUE: 21, RED: 47 }, teamGold: { BLUE: null, RED: null }, patch: null,
  });
  assert.equal(session.suggestWinnerSide(), "RED");
});
