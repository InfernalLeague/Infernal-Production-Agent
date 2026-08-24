import https from "node:https";
import type { LcuChampSelectSession, LcuChampionSummary } from "../types.js";
import type { LcuDataSource } from "./LcuDataSource.js";
import { readLockfile, type LcuCredentials } from "./lockfile.js";

/**
 * Klient k LCU API (League Client) – čte champ select.
 * Autentizace: Basic riot:<password> z lockfile. Self-signed cert (lokální).
 *
 * Credentials se čtou z lockfile při každém požadavku znovu (port/heslo se
 * mění s každým spuštěním klienta). Když klient neběží, metody vrací null/[].
 */
export class LcuClient implements LcuDataSource {
  private readonly agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  private champCache: LcuChampionSummary[] | null = null;

  constructor(private readonly lockfilePath: string, private readonly timeoutMs = 2000) {}

  private creds(): LcuCredentials | null {
    return readLockfile(this.lockfilePath);
  }

  async champSelectSession(): Promise<LcuChampSelectSession | null> {
    try {
      return await this.get<LcuChampSelectSession>("/lol-champ-select/v1/session");
    } catch {
      // 404 = zrovna neběží žádný champ select; klient nedostupný = totéž pro nás
      return null;
    }
  }

  async championSummary(): Promise<LcuChampionSummary[]> {
    if (this.champCache) return this.champCache;
    try {
      const list = await this.get<LcuChampionSummary[]>("/lol-game-data/assets/v1/champion-summary.json");
      this.champCache = list;
      return list;
    } catch {
      return [];
    }
  }

  private get<T>(pathname: string): Promise<T> {
    const creds = this.creds();
    if (!creds) return Promise.reject(new Error("LCU lockfile nenalezen (klient neběží?)"));

    const auth = "Basic " + Buffer.from(`riot:${creds.password}`).toString("base64");
    return new Promise<T>((resolve, reject) => {
      const req = https.request(
        {
          host: "127.0.0.1",
          port: creds.port,
          path: pathname,
          method: "GET",
          agent: this.agent,
          timeout: this.timeoutMs,
          headers: { Authorization: auth, Accept: "application/json" },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (body += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new Error("Neplatná JSON odpověď z LCU"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
  }
}
