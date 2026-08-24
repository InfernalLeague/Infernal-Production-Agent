import type { ConfirmedGame } from "../types.js";

/**
 * DatabaseExporter – zatím STUB (workflow §45, §68).
 * Ve Fázi 2 pošle stejný ConfirmedGame objekt na Infernal HUB API
 * (POST /api/games/{id}/stats). Záměrně existuje už teď, aby architektura
 * byla připravená a nemuselo se nic přepisovat (§69).
 */
export class DatabaseExporter {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async send(_game: ConfirmedGame): Promise<never> {
    throw new Error("SEND TO DATABASE není v první verzi k dispozici (Fáze 2).");
  }
}
