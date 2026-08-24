import type { LcuChampSelectSession, LcuChampionSummary } from "../types.js";
import type { LcuDataSource } from "./LcuDataSource.js";

/**
 * Mock LCU klient (--mock). Vrací dokončený champ select pro hru
 * Ixtal (modrá) vs Freljord (červená) během prvních ~8 s (fáze draftu),
 * pak null (draft skončil, začíná hra). Sladěno s MockLiveClient.
 */
export class MockLcuClient implements LcuDataSource {
  private startedAt = Date.now();
  private readonly draftSeconds = 8;

  // championId → jméno (odpovídá pickům/banům níže)
  private readonly champions: LcuChampionSummary[] = [
    { id: 50, name: "Swain", alias: "Swain" },
    { id: 62, name: "Wukong", alias: "MonkeyKing" },
    { id: 516, name: "Ornn", alias: "Ornn" },
    { id: 222, name: "Jinx", alias: "Jinx" },
    { id: 111, name: "Nautilus", alias: "Nautilus" },
    { id: 150, name: "Gnar", alias: "Gnar" },
    { id: 254, name: "Vi", alias: "Vi" },
    { id: 103, name: "Ahri", alias: "Ahri" },
    { id: 145, name: "Kai'Sa", alias: "Kaisa" },
    { id: 412, name: "Thresh", alias: "Thresh" },
    { id: 350, name: "Yuumi", alias: "Yuumi" },
    { id: 221, name: "Zeri", alias: "Zeri" },
    { id: 429, name: "Kalista", alias: "Kalista" },
    { id: 119, name: "Draven", alias: "Draven" },
    { id: 235, name: "Senna", alias: "Senna" },
    { id: 7, name: "LeBlanc", alias: "Leblanc" },
    { id: 84, name: "Akali", alias: "Akali" },
    { id: 888, name: "Renata Glasc", alias: "Renata" },
    { id: 76, name: "Nidalee", alias: "Nidalee" },
    { id: 22, name: "Ashe", alias: "Ashe" },
  ];

  private readonly blueBans = [350, 221, 429, 119, 235];
  private readonly redBans = [7, 84, 888, 76, 22];
  // picky podle cellId (0–4 modrá, 5–9 červená) – sedí na MockLiveClient
  private readonly picks: Array<{ cell: number; champ: number; pos: string }> = [
    { cell: 0, champ: 50, pos: "middle" },
    { cell: 1, champ: 62, pos: "jungle" },
    { cell: 2, champ: 516, pos: "top" },
    { cell: 3, champ: 222, pos: "bottom" },
    { cell: 4, champ: 111, pos: "utility" },
    { cell: 5, champ: 150, pos: "top" },
    { cell: 6, champ: 254, pos: "jungle" },
    { cell: 7, champ: 103, pos: "middle" },
    { cell: 8, champ: 145, pos: "bottom" },
    { cell: 9, champ: 412, pos: "utility" },
  ];

  async championSummary(): Promise<LcuChampionSummary[]> {
    return this.champions;
  }

  async champSelectSession(): Promise<LcuChampSelectSession | null> {
    const elapsed = (Date.now() - this.startedAt) / 1000;
    if (elapsed >= this.draftSeconds) return null; // draft skončil

    const banActions = [];
    for (let i = 0; i < 5; i++) {
      banActions.push(this.action(i, this.blueBans[i], "ban"));
      banActions.push(this.action(5 + i, this.redBans[i], "ban"));
    }
    const pickActions = [];
    for (let i = 0; i < 5; i++) {
      pickActions.push(this.action(i, this.picks[i].champ, "pick"));
      pickActions.push(this.action(5 + i, this.picks[5 + i].champ, "pick"));
    }

    return {
      actions: [banActions, pickActions],
      bans: { myTeamBans: this.blueBans, theirTeamBans: this.redBans, numBans: 10 },
      myTeam: this.picks.slice(0, 5).map((p) => ({ cellId: p.cell, championId: p.champ, assignedPosition: p.pos })),
      theirTeam: this.picks.slice(5).map((p) => ({ cellId: p.cell, championId: p.champ, assignedPosition: p.pos })),
      localPlayerCellId: -1,
      timer: { phase: "FINALIZATION" },
    };
  }

  private action(cell: number, champ: number, type: "ban" | "pick") {
    return { id: cell * 10 + (type === "ban" ? 1 : 2), actorCellId: cell, championId: champ, completed: true, type, isInProgress: false };
  }
}
