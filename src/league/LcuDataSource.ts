import type { LcuChampSelectSession, LcuChampionSummary } from "../types.js";

/**
 * Rozhraní k LCU (League Client) API pro champ select.
 * Reálný klient i mock ho implementují.
 */
export interface LcuDataSource {
  /** Aktuální champ select session, nebo null když žádný draft neběží. */
  champSelectSession(): Promise<LcuChampSelectSession | null>;
  /** Mapování championId → jméno (LCU champion-summary.json). */
  championSummary(): Promise<LcuChampionSummary[]>;
}
