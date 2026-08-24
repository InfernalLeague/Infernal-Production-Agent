import fs from "node:fs";

export interface LcuCredentials {
  port: number;
  password: string;
  protocol: string; // "https"
}

/**
 * Přečte a rozparsuje lockfile League klienta.
 * Formát: LeagueClient:<pid>:<port>:<password>:<protocol>
 * Vrací null, když soubor neexistuje (klient neběží / jiná cesta).
 */
export function readLockfile(lockfilePath: string): LcuCredentials | null {
  try {
    const raw = fs.readFileSync(lockfilePath, "utf8").trim();
    const parts = raw.split(":");
    if (parts.length < 5) return null;
    return {
      port: Number(parts[2]),
      password: parts[3],
      protocol: parts[4] || "https",
    };
  } catch {
    return null;
  }
}
