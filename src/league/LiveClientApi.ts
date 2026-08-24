import https from "node:https";
import type { AllGameData } from "../types.js";

/**
 * Nízkoúrovňový klient k Live Client Data API běžícímu s LoL hrou.
 * Endpoint: GET {base}/liveclientdata/allgamedata
 *
 * League používá vlastní self-signed certifikát, proto rejectUnauthorized:false.
 * (Spojení je čistě lokální na 127.0.0.1, žádná externí komunikace.)
 */
export class LiveClientApi {
  private readonly agent: https.Agent;

  constructor(private readonly base: string, private readonly timeoutMs = 2000) {
    this.agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  }

  /** Vrátí kompletní data hry, nebo vyhodí chybu (hra neběží / API nedostupné). */
  allGameData(): Promise<AllGameData> {
    return this.getJson<AllGameData>("/liveclientdata/allgamedata");
  }

  private getJson<T>(pathname: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const url = `${this.base}${pathname}`;
      const req = https.get(url, { agent: this.agent, timeout: this.timeoutMs }, (res) => {
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
            reject(new Error("Neplatná JSON odpověď z Live API"));
          }
        });
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    });
  }
}
