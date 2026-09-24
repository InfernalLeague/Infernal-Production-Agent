import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type {
  BroadcastGameEvent,
  BroadcastGameSnapshot,
  GameMeta,
  LiveDeliveryStatus,
  LiveTransportEnvelope,
  LiveTransportKind,
  LiveTransportSource,
} from "../types.js";
import { log } from "../util/logger.js";
import { writeJsonAtomic } from "../util/storage.js";

/**
 * Stabilní hranice mezi sběrem dat a budoucí databází.
 * Vždy zapisuje lokální JSONL audit. Je-li nastaven INFERNAL_INGEST_URL,
 * zprávy navíc ukládá do outboxu a spolehlivě je odesílá přes HTTP.
 */
export class LiveStreamPublisher extends EventEmitter {
  private meta: GameMeta | null = null;
  private folder: string | null = null;
  private sequence = 0;
  private lastSnapshotAt = 0;
  private lastSnapshotSignature = "";
  private flushing = false;
  private status: LiveDeliveryStatus = {
    mode: config.liveIngest.url ? "remote" : "local-only",
    configured: Boolean(config.liveIngest.url),
    pending: 0,
    delivered: 0,
    failed: 0,
    lastDeliveredAt: null,
    lastError: null,
  };

  constructor() {
    super();
    fs.mkdirSync(this.pendingDir(), { recursive: true });
    this.refreshPendingCount();
    if (this.status.configured) {
      void this.flush();
      const retryTimer = setInterval(() => void this.flush(), 5000);
      retryTimer.unref();
    }
  }

  beginGame(meta: GameMeta, folder: string): void {
    this.meta = meta;
    this.folder = folder;
    this.sequence = this.readLastSequence(folder);
    this.lastSnapshotAt = 0;
    this.lastSnapshotSignature = "";
    this.publish("lifecycle", "game.created", config.mock ? "mock" : "league-broadcast", null, {
      game: meta,
    });
  }

  publishEvent(event: BroadcastGameEvent, source: LiveTransportSource = "league-broadcast"): void {
    this.publish("event", event.type, source, event.gameTime, event.payload, event.capturedAt);
  }

  publishSnapshot(snapshot: BroadcastGameSnapshot, source: LiveTransportSource, force = false): void {
    if (!this.meta || !this.folder) return;
    const signature = JSON.stringify({
      gameTime: Math.floor(snapshot.gameTime * 2) / 2,
      players: snapshot.players,
      teamKills: snapshot.teamKills,
      teamGold: snapshot.teamGold,
      patch: snapshot.patch,
      objectives: snapshot.objectives?.timeline.length ?? 0,
    });
    const now = Date.now();
    if (!force && (signature === this.lastSnapshotSignature || now - this.lastSnapshotAt < config.liveSnapshotMinIntervalMs)) {
      return;
    }
    this.lastSnapshotAt = now;
    this.lastSnapshotSignature = signature;
    const envelope = this.publish("snapshot", "game.state", source, snapshot.gameTime, snapshot, snapshot.capturedAt);
    if (envelope) writeJsonAtomic(path.join(this.folder, "live_state.json"), envelope);
  }

  finalize(durationSeconds: number | null, source: LiveTransportSource, snapshot?: BroadcastGameSnapshot): void {
    if (snapshot) this.publishSnapshot(snapshot, source, true);
    this.publish("lifecycle", "game.ended", source, durationSeconds, {
      durationSeconds,
      durationDisplay: formatDuration(durationSeconds),
    });
  }

  getStatus(): LiveDeliveryStatus {
    return { ...this.status };
  }

  private publish(
    kind: LiveTransportKind,
    type: string,
    source: LiveTransportSource,
    gameTime: number | null,
    payload: unknown,
    capturedAt = new Date().toISOString(),
  ): LiveTransportEnvelope | null {
    if (!this.meta || !this.folder) return null;
    const sequence = ++this.sequence;
    const envelope: LiveTransportEnvelope = {
      schemaVersion: 1,
      eventId: `${this.meta.localGameId}:${String(sequence).padStart(8, "0")}`,
      localGameId: this.meta.localGameId,
      sequence,
      kind,
      type,
      source,
      capturedAt,
      gameTime: gameTime === null ? null : Math.max(0, gameTime),
      payload,
    };

    fs.mkdirSync(this.folder, { recursive: true });
    fs.appendFileSync(path.join(this.folder, "live_events.jsonl"), JSON.stringify(envelope) + "\n", "utf8");

    if (this.status.configured) {
      // eventId contains a colon, which is not valid in Windows filenames.
      const pendingName = `${envelope.localGameId}_${String(envelope.sequence).padStart(8, "0")}.json`;
      writeJsonAtomic(path.join(this.pendingDir(), pendingName), envelope);
      this.refreshPendingCount();
      void this.flush();
    }
    this.emitStatus();
    return envelope;
  }

  private async flush(): Promise<void> {
    if (this.flushing || !config.liveIngest.url) return;
    this.flushing = true;
    try {
      for (const file of this.pendingFiles()) {
        const fullPath = path.join(this.pendingDir(), file);
        let envelope: LiveTransportEnvelope;
        try {
          envelope = JSON.parse(fs.readFileSync(fullPath, "utf8")) as LiveTransportEnvelope;
        } catch {
          continue;
        }

        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (config.liveIngest.token) headers.Authorization = `Bearer ${config.liveIngest.token}`;
          const response = await fetch(config.liveIngest.url, {
            method: "POST",
            headers,
            body: JSON.stringify(envelope),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          fs.unlinkSync(fullPath);
          this.status.delivered += 1;
          this.status.lastDeliveredAt = new Date().toISOString();
          this.status.lastError = null;
        } catch (error) {
          this.status.failed += 1;
          this.status.lastError = error instanceof Error ? error.message : String(error);
          log.warn(`Live ingest selhal, zpráva zůstává v outboxu: ${this.status.lastError}`);
          break;
        }
        this.refreshPendingCount();
        this.emitStatus();
      }
    } finally {
      this.flushing = false;
      this.refreshPendingCount();
      this.emitStatus();
    }
  }

  private pendingDir(): string {
    return path.join(config.paths.data, "outbox", "pending");
  }

  private pendingFiles(): string[] {
    try {
      return fs.readdirSync(this.pendingDir()).filter((name) => name.endsWith(".json")).sort();
    } catch {
      return [];
    }
  }

  private refreshPendingCount(): void {
    this.status.pending = this.pendingFiles().length;
  }

  private emitStatus(): void {
    this.emit("status", this.getStatus());
  }

  private readLastSequence(folder: string): number {
    try {
      const lines = fs.readFileSync(path.join(folder, "live_events.jsonl"), "utf8").trim().split(/\r?\n/);
      const last = JSON.parse(lines.at(-1) ?? "{}") as Partial<LiveTransportEnvelope>;
      return Number.isFinite(last.sequence) ? Number(last.sequence) : 0;
    } catch {
      return 0;
    }
  }
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
