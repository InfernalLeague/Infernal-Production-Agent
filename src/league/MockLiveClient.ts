import type { AllGameData, RiotPlayer } from "../types.js";
import type { LiveDataSource } from "./LiveDataSource.js";

/**
 * Mock zdroj live dat (přepínač --mock). Simuluje jednu hru Ixtal vs Freljord,
 * která postupně "hraje" a po ~90 s skončí (Live API začne házet chybu jako
 * při reálném konci hry). Slouží k vývoji a testování celého toku Fáze 1A
 * bez běžícího League of Legends.
 */
export class MockLiveClient implements LiveDataSource {
  private startedAt = Date.now();
  /** Reálné sekundy "champ selectu" na začátku (Live API zatím mlčí). */
  private readonly draftSeconds = 8;
  /** Kolik reálných sekund necháme "hru" běžet, než začne API mlčet. */
  private readonly runSeconds = 90;
  /** Kolik herního času nasimulujeme na konci (32:53 = 1973 s). */
  private readonly targetGameTime = 1973;

  private readonly blue = [
    { name: "Risotto Nero", champ: "Swain", pos: "MIDDLE" },
    { name: "King of Isolde", champ: "Wukong", pos: "JUNGLE" },
    { name: "Ixtal Top", champ: "Ornn", pos: "TOP" },
    { name: "Ixtal ADC", champ: "Jinx", pos: "BOTTOM" },
    { name: "Ixtal Supp", champ: "Nautilus", pos: "UTILITY" },
  ];
  private readonly red = [
    { name: "Frel Top", champ: "Gnar", pos: "TOP" },
    { name: "Frel Jungle", champ: "Vi", pos: "JUNGLE" },
    { name: "Frel Mid", champ: "Ahri", pos: "MIDDLE" },
    { name: "Frel ADC", champ: "Kaisa", pos: "BOTTOM" },
    { name: "Frel Supp", champ: "Thresh", pos: "UTILITY" },
  ];

  async allGameData(): Promise<AllGameData> {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    if (elapsed < this.draftSeconds) {
      // Fáze champ selectu: in-game API ještě neodpovídá.
      throw new Error("ECONNREFUSED (mock: probíhá champ select)");
    }
    if (elapsed > this.draftSeconds + this.runSeconds) {
      // Simulace konce hry: reálné API po skončení přestane odpovídat.
      throw new Error("ECONNREFUSED (mock: hra skončila)");
    }
    const p = Math.min((elapsed - this.draftSeconds) / this.runSeconds, 1); // postup hry 0..1
    const gameTime = Math.round(this.targetGameTime * p);

    // Freljord (červená) vede a nakonec vyhraje 20:5 (dle příkladu §42).
    const players: RiotPlayer[] = [
      ...this.blue.map((b, i) => this.mkPlayer(b, "ORDER", p, i, false)),
      ...this.red.map((r, i) => this.mkPlayer(r, "CHAOS", p, i, true)),
    ];

    return {
      allPlayers: players,
      events: { Events: this.mkEvents(p) },
      gameData: { gameMode: "CLASSIC", gameTime, mapTerrain: "Infernal", mapNumber: 11 },
    };
  }

  private mkPlayer(
    b: { name: string; champ: string; pos: string },
    team: "ORDER" | "CHAOS",
    p: number,
    idx: number,
    winning: boolean,
  ): RiotPlayer {
    const scale = winning ? 1 : 0.55;
    const kills = Math.round((idx + 2) * 1.6 * p * scale);
    const deaths = Math.round((6 - idx) * p * (winning ? 0.6 : 1.4));
    const assists = Math.round((idx + 3) * 2 * p * scale);
    const cs = Math.round((160 + idx * 30) * p);
    const ward = Math.round((12 + idx * 8) * p);
    const level = Math.max(1, Math.min(18, Math.round(1 + 15 * p)));
    return {
      championName: b.champ,
      summonerName: b.name,
      riotIdGameName: b.name,
      team,
      level,
      position: b.pos,
      scores: { kills, deaths, assists, creepScore: cs, wardScore: ward },
      items: [3153, 3006, 3031, 6672]
        .slice(0, Math.round(4 * p))
        .map((itemID, slot) => ({ itemID, count: 1, slot })),
    };
  }

  private mkEvents(p: number): AllGameData["events"]["Events"] {
    const ev: AllGameData["events"]["Events"] = [
      { EventID: 0, EventName: "GameStart", EventTime: 0 },
    ];
    // First blood pro Freljord Jungle brzy ve hře (demo detekce first blood).
    if (p > 0.1) {
      ev.push({
        EventID: 1,
        EventName: "ChampionKill",
        EventTime: 95,
        KillerName: "Frel Jungle",
        VictimName: "Risotto Nero",
      });
    }
    // Objektivy v průběhu hry (demo detekce draků, baronů, věží…).
    // Časy jsou herní sekundy; zobrazí se, jakmile na ně hra "dojde".
    const gameTime = this.targetGameTime * p;
    const objectives: AllGameData["events"]["Events"] = [
      { EventID: 10, EventName: "HordeKill", EventTime: 330, KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 11, EventName: "HordeKill", EventTime: 331, KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 12, EventName: "HordeKill", EventTime: 332, KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 13, EventName: "DragonKill", EventTime: 360, DragonType: "Fire", KillerName: "King of Isolde", Stolen: "False" },
      { EventID: 14, EventName: "TurretKilled", EventTime: 540, TurretKilled: "Turret_T1_L_03_A", KillerName: "Frel Top" },
      { EventID: 15, EventName: "DragonKill", EventTime: 690, DragonType: "Water", KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 16, EventName: "HeraldKill", EventTime: 840, KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 17, EventName: "DragonKill", EventTime: 1020, DragonType: "Chemtech", KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 18, EventName: "TurretKilled", EventTime: 1100, TurretKilled: "Turret_T2_R_03_A", KillerName: "Minion_T1L0S0N0" },
      { EventID: 19, EventName: "DragonKill", EventTime: 1340, DragonType: "Chemtech", KillerName: "Frel ADC", Stolen: "False" },
      { EventID: 20, EventName: "BaronKill", EventTime: 1500, KillerName: "Frel Jungle", Stolen: "False" },
      { EventID: 21, EventName: "DragonKill", EventTime: 1660, DragonType: "Chemtech", KillerName: "King of Isolde", Stolen: "True" },
      { EventID: 22, EventName: "TurretKilled", EventTime: 1760, TurretKilled: "Turret_T1_C_05_A", KillerName: "Frel Mid" },
      { EventID: 23, EventName: "InhibKilled", EventTime: 1800, InhibKilled: "Barracks_T1_C1", KillerName: "Frel Mid" },
    ];
    ev.push(...objectives.filter((event) => event.EventTime <= gameTime));

    // Ke konci hry přidáme pentakill pro Freljord ADC (demo detekce §14).
    if (p > 0.9) {
      ev.push({ EventID: 99, EventName: "Multikill", EventTime: 1600, KillStreak: 5, KillerName: "Frel ADC" });
    }
    return ev;
  }
}
