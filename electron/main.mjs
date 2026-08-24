// Electron shell Infernal Production Agenta.
//
// Úkol main procesu:
//   1) nasměrovat zapisovatelná data do userData (v .exe se vedle binárky psát nesmí),
//   2) nabootovat zkompilovaný backend (dist/index.js) – NE tsx,
//   3) otevřít okno s dashboardem a servírovat overlaye z /overlay/*,
//   4) auto-update z GitHub Releases + most (IPC) do dashboardu (verze, update okno).
//
// Viz docs/ROADMAP.md.

import { app, BrowserWindow, shell, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { autoUpdater } = electronUpdater;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT ?? 4700);
const DASHBOARD_URL = `http://localhost:${PORT}/`;

let mainWindow = null;
// Poslední stav updatu; drží se, aby ho šlo poslat i po (re)connectu rendereru.
let updateStatus = { state: "none" };

// --- Konfigurace cest PŘED importem backendu (config.ts je čte z env) ----------
process.env.INFERNAL_DATA_DIR = app.getPath("userData");
process.env.INFERNAL_ASSETS_DIR = app.isPackaged ? process.resourcesPath : AGENT_ROOT;
process.env.INFERNAL_VERSION = app.getVersion();
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
  const iconPath = path.join(AGENT_ROOT, "build", "icon.ico");
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    title: "Infernal Production Agent",
    backgroundColor: "#0f0f14",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadURL(DASHBOARD_URL);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return mainWindow;
}

/** Pošle aktuální stav updatu do rendereru (dashboardu). */
function sendUpdate(status) {
  updateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:status", status);
  }
}

// --- IPC most do dashboardu -------------------------------------------------
ipcMain.handle("app:getVersion", () => app.getVersion());
ipcMain.on("update:request", (e) => e.sender.send("update:status", updateStatus));
ipcMain.on("update:install", () => {
  try {
    autoUpdater.quitAndInstall();
  } catch (err) {
    console.error("[updater] quitAndInstall selhal:", err?.message ?? err);
  }
});

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
 * Auto-update z GitHub Releases (electron-updater). Běží jen v zabalené appce.
 * Novou verzi stáhne na pozadí; dashboard přes IPC ukáže okno s číslem verze
 * a poznámkami. Po stažení nabídne "Restartovat a nainstalovat".
 * Feed = electron-builder.yml → publish.
 */
function checkForUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

  autoUpdater.on("update-available", (i) =>
    sendUpdate({ state: "available", version: i?.version ?? "", notes: normalizeNotes(i?.releaseNotes) }),
  );
  autoUpdater.on("update-downloaded", (i) =>
    sendUpdate({ state: "downloaded", version: i?.version ?? "", notes: normalizeNotes(i?.releaseNotes) }),
  );
  autoUpdater.on("update-not-available", () => sendUpdate({ state: "none" }));
  autoUpdater.on("error", (err) => {
    console.error("[updater]", err?.message ?? err);
    sendUpdate({ state: "error", message: String(err?.message ?? err) });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[updater] check selhal:", err?.message ?? err);
    sendUpdate({ state: "error", message: String(err?.message ?? err) });
  });
}

/** releaseNotes může být string nebo pole {version, note}; sjednotíme na text. */
function normalizeNotes(notes) {
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  if (Array.isArray(notes)) return notes.map((n) => n?.note ?? "").join("\n\n");
  return "";
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
