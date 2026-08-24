import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/** Zajistí, že ZAPISOVATELNÉ runtime adresáře existují (workflow §49). */
export function ensureDirs(): void {
  // public a overlays jsou read-only bundlené assety — nevytváříme je.
  const readOnly = new Set<string>([config.paths.public, config.paths.overlays]);
  for (const dir of Object.values(config.paths)) {
    if (readOnly.has(dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Zapíše JSON atomicky (přes .tmp), aby pád při zápisu neporušil soubor. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

/** Zapíše libovolný text (např. TXT export). */
export function writeText(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

/**
 * Složka pro konkrétní hru (workflow §49):
 *   games/2026-08-18_Ixtal_Freljord_G2/
 */
export function gameFolder(dateIso: string, team1: string, team2: string, gameNumber: number): string {
  const date = dateIso.slice(0, 10);
  const slug = `${date}_${sanitize(team1)}_${sanitize(team2)}_G${gameNumber}`;
  return path.join(config.paths.games, slug);
}

/** Bezpečný název pro souborový systém. */
export function sanitize(s: string): string {
  return s.replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "") || "X";
}
