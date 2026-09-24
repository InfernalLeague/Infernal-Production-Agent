import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Kořen projektu (o úroveň výš než /src, resp. /dist). */
export const ROOT = path.resolve(__dirname, "..");

/**
 * Verze aplikace. V Electronu ji main proces předá přes INFERNAL_VERSION
 * (app.getVersion()), v dev režimu se čte z package.json.
 */
function readVersion(): string {
  if (process.env.INFERNAL_VERSION) return process.env.INFERNAL_VERSION;
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version ?? "dev";
  } catch {
    return "dev";
  }
}

/**
 * Base adresář pro ZAPISOVATELNÁ data (data/games/logs).
 *
 * V dev režimu = ROOT (jako dřív). V zabalené Electron .exe main proces nastaví
 * `INFERNAL_DATA_DIR` na `app.getPath("userData")`, protože vedle .exe se
 * (Program Files) zapisovat nesmí. Viz docs/ROADMAP.md, Fáze 0.
 */
const DATA_ROOT = process.env.INFERNAL_DATA_DIR
  ? path.resolve(process.env.INFERNAL_DATA_DIR)
  : ROOT;

/**
 * Base adresář pro READ-ONLY bundlené assety (public dashboard, overlaye).
 *
 * V dev = ROOT. V zabalené .exe main proces nastaví `INFERNAL_ASSETS_DIR` na
 * cestu do resources (extraResources), odkud se servírují statické soubory.
 */
const ASSETS_ROOT = process.env.INFERNAL_ASSETS_DIR
  ? path.resolve(process.env.INFERNAL_ASSETS_DIR)
  : ROOT;

export const config = {
  /** Verze aplikace (zobrazená v rohu dashboardu, /api/meta). */
  version: readVersion(),

  /** Port lokálního dashboardu (a hostingu overlayů). */
  port: Number(process.env.PORT ?? 4700),

  /** Live Client Data API běžící lokálně s League hrou. */
  liveApiBase: "https://127.0.0.1:2999",

  /** Jak často číst live data (workflow §9: cca 1× za sekundu). */
  pollIntervalMs: 1000,

  /** LeagueBroadcast WebSocket – primární rychlý zdroj ingame dat. */
  leagueBroadcast: {
    host: process.env.LEAGUE_BROADCAST_HOST ?? "localhost",
    port: Number(process.env.LEAGUE_BROADCAST_PORT ?? 58869),
    enabled: process.env.LEAGUE_BROADCAST_ENABLED !== "0",
  },

  /** Minimální odstup databázových snapshotů; diskrétní eventy se netlumí. */
  liveSnapshotMinIntervalMs: Number(process.env.LIVE_SNAPSHOT_INTERVAL_MS ?? 500),

  /**
   * Budoucí Supabase Edge Function / ingest endpoint. Bez URL běží local-only
   * režim a kontrakt se zapisuje do složky hry pro bezpečné testování.
   */
  liveIngest: {
    url: process.env.INFERNAL_INGEST_URL?.trim() || null,
    token: process.env.INFERNAL_INGEST_TOKEN?.trim() || null,
  },

  /** Jak často ukládat recovery snapshot (workflow §13: 5–10 s). */
  recoveryIntervalMs: 5000,

  /**
   * Kolik sekund musí Live API mlčet, než hru prohlásíme za skončenou
   * (workflow §15: 10–15 s, aby se výpadek nepletl s koncem hry).
   */
  gameEndTimeoutMs: 12000,

  /** Mock režim: simuluje běžící hru bez League (přepínač --mock nebo MOCK=1). */
  mock: process.argv.includes("--mock") || process.env.MOCK === "1",

  /** Adresáře (workflow §49). Zapisovatelné pod DATA_ROOT, read-only pod ASSETS_ROOT. */
  paths: {
    data: path.join(DATA_ROOT, "data"),
    games: path.join(DATA_ROOT, "games"),
    logs: path.join(DATA_ROOT, "logs"),
    public: path.join(ASSETS_ROOT, "public"),
    /** Zbuilděné overlaye (Vue), servírované na /overlay/*. */
    overlays: path.join(ASSETS_ROOT, "overlays"),
  },
} as const;
