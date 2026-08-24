import { EventEmitter } from "node:events";
import type { AllGameData } from "../types.js";
import type { LiveDataSource } from "./LiveDataSource.js";
import { log } from "../util/logger.js";

/**
 * LeagueDataCollector (workflow §45): jediná vrstva, která mluví s Live API.
 * V pravidelném intervalu čte data a emituje události:
 *   - "data"        (AllGameData)  – úspěšné čtení
 *   - "unreachable" (Error)        – API neodpovídá (hra neběží / výpadek)
 *
 * Sám o sobě NEROZHODUJE o konci hry – to řeší GameManager podle timeoutu (§15).
 */
export class LeagueDataCollector extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  /** Čas posledního úspěšného čtení (ms epoch), nebo null. */
  lastOkAt: number | null = null;
  /** true, pokud poslední pokus o čtení uspěl. */
  reachable = false;

  constructor(private readonly source: LiveDataSource, private readonly intervalMs: number) {
    super();
  }

  start(): void {
    if (this.timer) return;
    log.info("LeagueDataCollector: start pollingu Live API");
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.busy) return; // nepřekrývat pomalé čtení
    this.busy = true;
    try {
      const data: AllGameData = await this.source.allGameData();
      this.reachable = true;
      this.lastOkAt = Date.now();
      this.emit("data", data);
    } catch (err) {
      const wasReachable = this.reachable;
      this.reachable = false;
      this.emit("unreachable", err);
      if (wasReachable) log.warn("Live API přestalo odpovídat:", (err as Error).message);
    } finally {
      this.busy = false;
    }
  }
}
