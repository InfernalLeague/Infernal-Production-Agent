// Electron shell Infernal Production Agenta (Fáze 0).
//
// Úkol main procesu:
//   1) nasměrovat zapisovatelná data do userData (v .exe se vedle binárky psát nesmí),
//   2) nabootovat zkompilovaný backend (dist/index.js) – NE tsx,
//   3) otevřít okno s dashboardem a servírovat overlaye z /overlay/*.
//
// Balení do distribuovatelné .exe (electron-builder + electron-updater) je Fáze 1.
// Viz docs/ROADMAP.md.

import { app, BrowserWindow, shell } from "electron";
import electronUpdater from "electron-updater";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 4700);
const DASHBOARD_URL = `http://localhost:${PORT}/`;

// --- Konfigurace cest PŘED importem backendu (config.ts je čte z env) ----------
// Zapisovatelná data vždy do userData (funguje v dev i v zabalené .exe).
process.env.INFERNAL_DATA_DIR = app.getPath("userData");
// Read-only assety (public dashboard + overlays): v .exe z resources, v dev z repa.
process.env.INFERNAL_ASSETS_DIR = app.isPackaged ? process.resourcesPath : AGENT_ROOT;
process.env.PORT = String(PORT);

/** Nabootuje backend v tomto procesu (spustí Express + collectory). */
async function startBackend() {
  const entry = pathToFileURL(path.join(AGENT_ROOT, "dist", "index.js")).href;
  await import(entry);
}

/** Počká, až server na PORTU odpovídá (max ~10 s), pak resolvne. */
function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(`http://localhost:${PORT}/api/state`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Backend nenaběhl včas."));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    title: "Infernal Production Agent",
    backgroundColor: "#0f0f14",
    webPreferences: { contextIsolation: true },
  });
  win.removeMenu();
  win.loadURL(DASHBOARD_URL);
  // Externí odkazy otevírat v systémovém prohlížeči, ne v okně appky.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    await waitForServer();
  } catch (err) {
    console.error("[electron] Backend se nepodařilo nastartovat:", err);
  }
  createWindow();
  checkForUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Auto-update z GitHub Releases (electron-updater). Běží jen v zabalené appce
 * (dev nemá co updatovat). Stáhne na pozadí a nainstaluje při příštím quitu;
 * uživatel nic nemusí řešit. Chyby (offline, špatný feed) jen zalogujeme.
 * Feed = electron-builder.yml → publish. Viz docs/ROADMAP.md, Fáze 1.
 */
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };
  autoUpdater.on("error", (err) => console.error("[updater]", err?.message ?? err));
  autoUpdater.on("update-available", (i) => console.log("[updater] nová verze:", i?.version));
  autoUpdater.on("update-downloaded", (i) => console.log("[updater] staženo, nainstaluje se při quitu:", i?.version));
  autoUpdater.checkForUpdatesAndNotify().catch((err) =>
    console.error("[updater] check selhal:", err?.message ?? err),
  );
}

app.on("window-all-closed", () => {
  // Na Windows/Linux zavření okna = konec appky (backend jede v témže procesu).
  if (process.platform !== "darwin") app.quit();
});
