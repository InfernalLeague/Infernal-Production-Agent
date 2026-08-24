import type {
  Draft,
  DraftBan,
  DraftPick,
  LcuChampSelectSession,
  LcuChampionSummary,
  Side,
} from "../types.js";

/** cellId 0–4 = modrá strana (team 1 sloty), 5–9 = červená. */
export function sideFromCell(cellId: number): Side {
  return cellId <= 4 ? "BLUE" : "RED";
}

/** Postaví mapu championId → jméno z LCU champion-summary. */
export function buildChampionMap(summary: LcuChampionSummary[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const c of summary) if (c.id > 0) m.set(c.id, c.name);
  return m;
}

/**
 * Normalizuje surovou champ select session na Draft.
 * Bany i picky se berou z pole `actions` (zachovává pořadí draftu) —
 * to je spolehlivější než `bans` objekt a dává i pořadí picků.
 * `order` je pořadí v rámci dané strany (B1, B2 … / P1, P2 …).
 */
export function normalizeDraft(
  session: LcuChampSelectSession,
  champions: Map<number, string>,
): Draft {
  const positionByCell = new Map<number, string>();
  for (const m of [...(session.myTeam ?? []), ...(session.theirTeam ?? [])]) {
    positionByCell.set(m.cellId, m.assignedPosition ?? "");
  }

  const flat = (session.actions ?? []).flat();
  const name = (id: number): string => champions.get(id) ?? (id > 0 ? `Champion#${id}` : "");

  const bans: DraftBan[] = [];
  const picks: DraftPick[] = [];
  const banOrder: Record<Side, number> = { BLUE: 0, RED: 0 };
  const pickOrder: Record<Side, number> = { BLUE: 0, RED: 0 };
  let allBanPickCompleted = true;

  for (const a of flat) {
    if (a.type !== "ban" && a.type !== "pick") continue;
    if (!a.completed || a.championId <= 0) {
      allBanPickCompleted = false;
      continue;
    }
    const side = sideFromCell(a.actorCellId);
    if (a.type === "ban") {
      bans.push({ side, championId: a.championId, championName: name(a.championId), order: ++banOrder[side] });
    } else {
      picks.push({
        side,
        cellId: a.actorCellId,
        championId: a.championId,
        championName: name(a.championId),
        order: ++pickOrder[side],
        position: positionByCell.get(a.actorCellId) ?? "",
      });
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    complete: allBanPickCompleted && picks.length >= 10,
    bans,
    picks,
  };
}
