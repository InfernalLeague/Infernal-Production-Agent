import { EventEmitter } from "node:events";
import type { Draft } from "../types.js";
import type { LcuDataSource } from "../league/LcuDataSource.js";
import { buildChampionMap, normalizeDraft } from "./normalizeDraft.js";
import { log } from "../util/logger.js";

/**
 * ChampSelectCollector: v pravidelném intervalu čte champ select z LCU
 * a emituje normalizovaný Draft.
 *   - "draft" (Draft)  – aktivní draft (průběžně aktualizovaný)
 *   - "draft" (null)   – žádný draft neběží
 *
 * Champion mapa (id → jméno) se načte jednou a cachuje.
 */
export class ChampSelectCollector extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private championMap: Map<number, string> | null = null;
  private hadDraft = false;

  /** true, pokud právě běží champ select. */
  active = false;

  constructor(private readonly source: LcuDataSource, private readonly intervalMs = 1500) {
    super();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const session = await this.source.champSelectSession();
      if (!session) {
        if (this.hadDraft) {
          this.hadDraft = false;
          this.active = false;
          this.emit("draft", null);
        }
        return;
      }
      if (!this.championMap || this.championMap.size === 0) {
        // Prázdnou mapu NECACHUJEME natrvalo: championSummary() vrací [] i při
        // chybě/nedostupnosti (ne throw), takže první nepovedený tik by jinak
        // zablokoval jména banů/picků (Champion#123) na celou session.
        this.championMap = buildChampionMap(await this.source.championSummary());
      }
      const draft = normalizeDraft(session, this.championMap ?? new Map());
      if (!this.hadDraft) log.info("Champ select detekován – čtu bany a picky.");
      this.hadDraft = true;
      this.active = true;
      this.emit("draft", draft);
    } catch {
      /* klient nedostupný – ticho, zkusíme příště */
    } finally {
      this.busy = false;
    }
  }
}
