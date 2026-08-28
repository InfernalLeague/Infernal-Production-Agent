import assert from "node:assert/strict";
import test from "node:test";
import "./LeagueBroadcastCollector.js";

test("doplní Node/Electron runtime pro reconnect LeagueBroadcast klienta", () => {
  const runtime = globalThis as unknown as {
    WebSocket?: unknown;
    window?: { setTimeout?: unknown; clearTimeout?: unknown };
  };

  assert.equal(typeof runtime.WebSocket, "function");
  assert.equal(typeof runtime.window?.setTimeout, "function");
  assert.equal(typeof runtime.window?.clearTimeout, "function");
});
