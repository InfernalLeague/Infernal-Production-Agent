import fs from "node:fs";
import path from "node:path";
import { inspect } from "node:util";
import { config } from "../config.js";

/**
 * Logger: konzole s časovým razítkem a zároveň denní soubor v `logs/`.
 *
 * Soubor je tu kvůli Electron buildu — konzoli tam nikdo nevidí, a po
 * zkušební hře pak nebylo z čeho zjistit, proč hra neskončila nebo co hlásil
 * LeagueBroadcast. Zápis do souboru nesmí shodit Agenta; chyba se polkne.
 */
function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function toFile(level: string, parts: unknown[]): void {
  try {
    const line = parts.map((part) => (typeof part === "string" ? part : inspect(part, { depth: 4 }))).join(" ");
    const file = path.join(config.paths.logs, `agent-${new Date().toISOString().slice(0, 10)}.log`);
    fs.mkdirSync(config.paths.logs, { recursive: true });
    fs.appendFileSync(file, `[${ts()}] ${level} ${line}\n`, "utf8");
  } catch {
    /* log do souboru je jen pomůcka */
  }
}

export const log = {
  info: (...a: unknown[]) => {
    console.log(`[${ts()}]`, ...a);
    toFile("INFO", a);
  },
  warn: (...a: unknown[]) => {
    console.warn(`[${ts()}] WARN`, ...a);
    toFile("WARN", a);
  },
  error: (...a: unknown[]) => {
    console.error(`[${ts()}] ERROR`, ...a);
    toFile("ERROR", a);
  },
};
