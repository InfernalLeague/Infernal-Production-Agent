import path from "node:path";
import type { ConfirmedGame } from "../types.js";
import { TxtExporter } from "./TxtExporter.js";
import { DatabaseExporter } from "./DatabaseExporter.js";
import { writeText, sanitize } from "../util/storage.js";

export type ExportMethod = "txt" | "database";

export interface ExportResult {
  method: ExportMethod;
  filename: string;
  filePath: string;
}

/**
 * Jednotný vstupní bod exportu (workflow §39: exportConfirmedGame() → adaptér).
 * V první verzi je aktivní pouze "txt". "database" je připravený stub (Fáze 2).
 */
export async function exportConfirmedGame(
  game: ConfirmedGame,
  method: ExportMethod,
  targetFolder: string,
): Promise<ExportResult> {
  if (method === "database") {
    await new DatabaseExporter().send(game); // vyhodí "není k dispozici"
    throw new Error("unreachable");
  }

  const text = new TxtExporter(true).export(game);
  const filename = txtFilename(game);
  const filePath = path.join(targetFolder, filename);
  writeText(filePath, text);
  // Kanonická kopie ve složce hry (workflow §49).
  writeText(path.join(targetFolder, "export.txt"), text);
  return { method, filename, filePath };
}

/** Infernal_Ixtal_vs_Freljord_Game2_2026-08-18.txt (workflow §41). */
export function txtFilename(game: ConfirmedGame): string {
  const g = game.game;
  const date = (g.confirmedAt ?? g.createdAt).slice(0, 10);
  return `Infernal_${sanitize(g.team1)}_vs_${sanitize(g.team2)}_Game${g.gameNumber}_${date}.txt`;
}
