import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  GameState,
  LeagueBroadcastClient,
  type ingameFrontendData,
} from "@bluebottle_gg/league-broadcast-client";
import type { BroadcastGameEvent, BroadcastGameSnapshot } from "../types.js";
import { log } from "../util/logger.js";
import {
  normalizeBroadcastSnapshot,
  normalizeKillEvent,
  normalizeObjectiveEvent,
  normalizePlayerEvent,
  normalizeTeamEvent,
} from "./normalizeBroadcast.js";

// BlueBottle je browser-compatible klient. V Node/Electron backendu mu dodáme
// již používanou implementaci `ws` se stejným WebSocket rozhraním.
if (!(globalThis as { WebSocket?: unknown }).WebSocket) {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

export interface LeagueBroadcastStatus {
  enabled: boolean;
  connected: boolean;
  gameState: string;
  lastSnapshotAt: number | null;
  lastError: string | null;
}

/** Centrální WebSocket vstup LeagueBroadcastu pro celý Agent. */
export class LeagueBroadcastCollector extends EventEmitter {
  private client: LeagueBroadcastClient | null = null;
  private latestSnapshot: BroadcastGameSnapshot | null = null;
  private status: LeagueBroadcastStatus;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly enabled = true,
  ) {
    super();
    this.status = {
      enabled,
      connected: false,
      gameState: enabled ? "CONNECTING" : "DISABLED",
      lastSnapshotAt: null,
      lastError: null,
    };
  }

  start(): void {
    if (!this.enabled || this.client) return;
    this.client = new LeagueBroadcastClient({
      host: this.host,
      port: this.port,
      autoConnect: false,
      postGameWsRoute: false,
      overlayHealth: false,
    });

    this.client.onIngameConnect(() => {
      this.status.connected = true;
      this.status.lastError = null;
      this.emitStatus();
      log.info(`LeagueBroadcast WebSocket připojen (${this.host}:${this.port}).`);
    });
    this.client.onIngameDisconnect(() => {
      this.status.connected = false;
      this.emitStatus();
      log.warn("LeagueBroadcast WebSocket odpojen – Riot Live API zůstává jako záloha.");
    });
    this.client.onIngameError((error) => {
      this.status.lastError = error instanceof Error ? error.message : "WebSocket connection error";
      this.emitStatus();
    });
    this.client.onIngameStatusChange((state) => {
      this.status.gameState = GameState[state] ?? String(state);
      this.emit("gameStatus", state);
      this.emitStatus();
    });
    this.client.onIngameStateUpdate((data: ingameFrontendData) => {
      const snapshot = normalizeBroadcastSnapshot(data);
      if (!snapshot) return;
      this.latestSnapshot = snapshot;
      this.status.lastSnapshotAt = Date.now();
      this.status.gameState = GameState[data.gameStatus] ?? this.status.gameState;
      this.emit("snapshot", snapshot);
      this.emitStatus();
    });
    this.client.onIngameEvents({
      onKillFeedEvent: (event) => this.emitEvent(normalizeKillEvent(event, this.latestSnapshot, this.gameTime())),
      onPlayerEvent: (event) => this.emitEvent(normalizePlayerEvent(event, this.gameTime())),
      onObjectiveEvent: (event) => this.emitEvent(normalizeObjectiveEvent(event, this.gameTime())),
      onTeamEvent: (event) => this.emitEvent(normalizeTeamEvent(event, this.gameTime())),
    });

    void this.client.connect().catch((error: unknown) => {
      this.status.lastError = error instanceof Error ? error.message : String(error);
      this.emitStatus();
      log.warn("LeagueBroadcast zatím není dostupný; klient se bude znovu připojovat.");
    });
  }

  stop(): void {
    this.client?.disconnect();
    this.client = null;
  }

  getStatus(): LeagueBroadcastStatus {
    return { ...this.status };
  }

  isFresh(maxAgeMs = 2500): boolean {
    return Boolean(this.status.connected && this.status.lastSnapshotAt && Date.now() - this.status.lastSnapshotAt < maxAgeMs);
  }

  private gameTime(): number | null {
    if (!this.client || !this.status.lastSnapshotAt) return null;
    return this.client.getGameTime();
  }

  private emitEvent(event: BroadcastGameEvent): void {
    this.emit("gameEvent", event);
  }

  private emitStatus(): void {
    this.emit("status", this.getStatus());
  }
}
