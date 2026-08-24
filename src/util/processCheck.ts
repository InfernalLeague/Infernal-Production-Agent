import { exec } from "node:child_process";

/**
 * Zjistí přes Windows `tasklist`, zda běží procesy League.
 *   - LeagueClient.exe        → klient (lobby, mimo hru)
 *   - "League of Legends.exe" → samotná hra
 * Na jiných OS vrací vždy false (Fáze 1A cílí na produkční Windows PC).
 */
export function checkLeagueProcesses(): Promise<{ client: boolean; game: boolean }> {
  if (process.platform !== "win32") {
    return Promise.resolve({ client: false, game: false });
  }
  return new Promise((resolve) => {
    exec("tasklist /FO CSV /NH", { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        resolve({ client: false, game: false });
        return;
      }
      const lower = stdout.toLowerCase();
      resolve({
        client: lower.includes("leagueclient.exe"),
        game: lower.includes("league of legends.exe"),
      });
    });
  });
}
