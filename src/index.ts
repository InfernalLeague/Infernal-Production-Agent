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
import { LeagueBroadcastCollector } from "./live/LeagueBroadcastCollector.js";
import { LiveStreamPublisher } from "./live/LiveStreamPublisher.js";

/**
 * Vstupní bod Infernal Production Agenta.
 * Sestaví: zdroj dat → collector → game manager → web server.
 */
function main(): void {
  log.info(`Infernal Production Agent v${config.version}`);

  const source: LiveDataSource = config.mock
    ? new MockLiveClient()
    : new LiveClientApi(config.liveApiBase);
  const lcu: LcuDataSource = config.mock
    ? new MockLcuClient()
    : new LcuClient(config.lcuLockfile);

  const collector = new LeagueDataCollector(source, config.pollIntervalMs);
  const champSelect = new ChampSelectCollector(lcu, config.champSelectPollMs);
  const broadcast = new LeagueBroadcastCollector(
    config.leagueBroadcast.host,
    config.leagueBroadcast.port,
    config.leagueBroadcast.enabled && !config.mock,
  );
  const publisher = new LiveStreamPublisher();
  const manager = new GameManager(collector, champSelect, broadcast, publisher);
  manager.start();
  startServer(manager);
}

main();
