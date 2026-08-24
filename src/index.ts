import { config } from "./config.js";
import { log } from "./util/logger.js";
import { LeagueDataCollector } from "./league/LeagueDataCollector.js";
import { LiveClientApi } from "./league/LiveClientApi.js";
import { MockLiveClient } from "./league/MockLiveClient.js";
import type { LiveDataSource } from "./league/LiveDataSource.js";
import { LcuClient } from "./league/LcuClient.js";
import { MockLcuClient } from "./league/MockLcuClient.js";
import type { LcuDataSource } from "./league/LcuDataSource.js";
import { ChampSelectCollector } from "./champselect/ChampSelectCollector.js";
import { GameManager } from "./core/GameManager.js";
import { startServer } from "./server/server.js";

/**
 * Vstupní bod Infernal Production Agenta (Fáze 1A).
 * Sestaví: zdroj dat → collector → game manager → web server.
 */
function main(): void {
  log.info("Infernal Production Agent – Fáze 1A");

  const source: LiveDataSource = config.mock
    ? new MockLiveClient()
    : new LiveClientApi(config.liveApiBase);
  const lcu: LcuDataSource = config.mock
    ? new MockLcuClient()
    : new LcuClient(config.lcuLockfile);

  const collector = new LeagueDataCollector(source, config.pollIntervalMs);
  const champSelect = new ChampSelectCollector(lcu, config.champSelectPollMs);
  const manager = new GameManager(collector, champSelect);
  manager.start();
  startServer(manager);
}

main();
