import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import type { GameManager } from "../core/GameManager.js";
import type { CreateGameInput, WebGameLink } from "../types.js";
import { fetchSchedule } from "../web/WebClient.js";
import { publicWebSettings, saveWebSettings } from "../web/settings.js";

/**
 * Lokální web server Fáze 1A:
 *  - serví dashboard (public/),
 *  - REST pro akce operátora,
 *  - WebSocket pro živé aktualizace stavu (1×/s+ při LIVE).
 */
export function startServer(manager: GameManager): void {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(config.paths.public));

  // Overlaye (Vue buildy) servírované z jednoho serveru pod různými cestami.
  // OBS browser source pak míří na http://localhost:<port>/overlay/ingame.
  // Nahrazuje samostatné Vite dev servery (viz docs/ROADMAP.md, Fáze 0).
  mountOverlay(app, "ingame");

  app.get("/api/state", (_req, res) => res.json(manager.getState()));

  // Meta o aplikaci (verze pro roh dashboardu, mock flag).
  app.get("/api/meta", (_req, res) => res.json({ version: config.version, mock: config.mock }));

  // Seznam her ze složky games/ (pro Dashboard: dohrané/čekající).
  app.get("/api/games", (_req, res) => res.json(listGames()));

  app.post("/api/game", (req, res) => {
    try {
      const b = req.body as Partial<CreateGameInput>;
      if (!b.team1 || !b.team2 || !b.gameNumber) {
        return res.status(400).json({ error: "Vyplň team1, team2 a game number." });
      }
      const meta = manager.createGame({
        team1: b.team1,
        team2: b.team2,
        gameNumber: Number(b.gameNumber),
        seriesFormat: b.seriesFormat || "BO5",
        production: b.production,
        team1Side: b.team1Side === "RED" ? "RED" : "BLUE",
        web: parseWebLink(b.web),
      });
      res.json({ ok: true, meta });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/game/winner", (req, res) => {
    try {
      const winner = (req.body?.winner ?? null) as string | null;
      manager.setWinner(winner || null);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Napojení na web: adresa a token produkce (token se nikdy nevrací celý).
  app.get("/api/settings/web", (_req, res) => res.json(publicWebSettings()));
  app.post("/api/settings/web", (req, res) => {
    const body = req.body as { webUrl?: string; token?: string | null };
    res.json(saveWebSettings({ webUrl: body.webUrl, token: body.token }));
  });

  // Program produkce z webu pro výběr hry v New Game.
  app.get("/api/web/schedule", async (req, res) => {
    try {
      const date = typeof req.query.date === "string" ? req.query.date : undefined;
      res.json(await fetchSchedule(date));
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  app.post("/api/game/sync", (_req, res) => {
    manager.resendResult();
    res.json({ ok: true });
  });

  app.post("/api/game/end", (_req, res) => {
    manager.forceEndGame();
    res.json({ ok: true });
  });

  app.post("/api/export/txt", async (_req, res) => {
    try {
      const result = await manager.exportTxt();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: "state", data: manager.getState() }));
  });

  manager.on("update", (state) => {
    const msg = JSON.stringify({ type: "state", data: state });
    for (const ws of wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  });

  server.listen(config.port, "127.0.0.1", () => {
    log.info(`Dashboard běží na  http://localhost:${config.port}`);
    if (config.mock) log.info("MOCK režim aktivní – simuluji hru Ixtal vs Freljord.");
  });
}

function parseWebLink(value: unknown): WebGameLink | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<WebGameLink>;
  if (typeof v.gameId !== "string" || typeof v.matchId !== "string") return null;
  return { gameId: v.gameId, matchId: v.matchId, label: typeof v.label === "string" ? v.label : "" };
}

/**
 * Načte hry ze složky games/ pro Dashboard. Preferuje confirmed.json (spolehlivé
 * názvy týmů + winner); jinak parsuje název složky a hlídá live_final/export.
 */
interface GameListItem {
  folder: string;
  date: string;
  title: string;
  gameNumber: number | null;
  winner: string | null;
  exported: boolean;
  ended: boolean;
}

function listGames(): GameListItem[] {
  const dir = config.paths.games;
  if (!fs.existsSync(dir)) return [];
  const out: GameListItem[] = [];
  for (const name of fs.readdirSync(dir)) {
    const folder = path.join(dir, name);
    try {
      if (!fs.statSync(folder).isDirectory()) continue;
    } catch {
      continue;
    }
    const date = /^\d{4}-\d{2}-\d{2}/.test(name) ? name.slice(0, 10) : "";
    const exported = fs.existsSync(path.join(folder, "export.txt"));
    const ended = exported || fs.existsSync(path.join(folder, "live_final.json"));
    let title = name;
    let gameNumber: number | null = null;
    let winner: string | null = null;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(folder, "confirmed.json"), "utf8"));
      title = `${c.game.team1} vs ${c.game.team2}`;
      gameNumber = c.game.gameNumber ?? null;
      winner = c.game.winner ?? null;
    } catch {
      // fallback: název složky "YYYY-MM-DD_Team1_Team2_G<n>"
      const m = name.match(/^\d{4}-\d{2}-\d{2}_(.+)_G(\d+)(?:_ILT-.+)?$/);
      if (m) {
        title = m[1].replace(/_/g, " ");
        gameNumber = Number(m[2]);
      }
    }
    out.push({ folder: name, date, title, gameNumber, winner, exported, ended });
  }
  // nejnovější první (podle názvu složky = datum + pořadí)
  out.sort((a, b) => b.folder.localeCompare(a.folder));
  return out;
}

/**
 * Připojí jeden zbuilděný overlay na `/overlay/<name>`.
 * Overlay musí být postavený s relativním `base` ('./'), aby cesty k assetům
 * fungovaly pod podcestou. Pokud build chybí, cesta vrací 404 s nápovědou
 * (místo tichého selhání), viz docs/ROADMAP.md, Fáze 0.
 */
function mountOverlay(app: express.Express, name: string): void {
  const dir = path.join(config.paths.overlays, name);
  const mount = `/overlay/${name}`;
  if (fs.existsSync(path.join(dir, "index.html"))) {
    app.use(mount, express.static(dir));
    log.info(`Overlay '${name}' na  http://localhost:${config.port}${mount}`);
  } else {
    app.get(mount, (_req, res) =>
      res.status(404).type("text").send(
        `Overlay '${name}' není zbuilděný.\nSpusť:  npm run build:overlays\n(hledám index.html v ${dir})`,
      ),
    );
    log.warn(`Overlay '${name}' chybí (${dir}) – spusť 'npm run build:overlays'.`);
  }
}
