import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "../config.js";
import { log } from "../util/logger.js";
import type { GameManager } from "../core/GameManager.js";
import type { CreateGameInput } from "../types.js";

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
  // OBS browser source pak míří na http://localhost:<port>/overlay/ingame|pickban.
  // Nahrazuje samostatné Vite dev servery (viz docs/ROADMAP.md, Fáze 0).
  mountOverlay(app, "ingame");
  mountOverlay(app, "pickban");

  app.get("/api/state", (_req, res) => res.json(manager.getState()));

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
      });
      res.json({ ok: true, meta });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/game/winner", (req, res) => {
    const winner = (req.body?.winner ?? null) as string | null;
    manager.setWinner(winner || null);
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

  server.listen(config.port, () => {
    log.info(`Dashboard běží na  http://localhost:${config.port}`);
    if (config.mock) log.info("MOCK režim aktivní – simuluji hru Ixtal vs Freljord.");
  });
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
