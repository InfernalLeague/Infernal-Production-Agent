// Zbuildí oba Vue overlaye a zkopíruje jejich dist do <agent>/overlays/<name>,
// odkud je Express servíruje na /overlay/<name>. Nahrazuje samostatné Vite
// dev servery. Viz docs/ROADMAP.md, Fáze 0.
//
// Zdroj overlayů je v monorepu Agenta:
//   overlays-src/ingame   → overlays/ingame
//   overlays-src/pickban  → overlays/pickban
// Cesty lze přepsat přes INGAME_OVERLAY_DIR / PICKBAN_OVERLAY_DIR.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(__dirname, "..");
const SRC_ROOT = path.join(AGENT_ROOT, "overlays-src");

const overlays = [
  {
    name: "ingame",
    src: process.env.INGAME_OVERLAY_DIR ?? path.join(SRC_ROOT, "ingame"),
  },
  {
    name: "pickban",
    src: process.env.PICKBAN_OVERLAY_DIR ?? path.join(SRC_ROOT, "pickban"),
  },
];

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

for (const { name, src } of overlays) {
  if (!fs.existsSync(src)) {
    console.error(`[build-overlays] Zdroj overlaye '${name}' nenalezen: ${src}`);
    process.exit(1);
  }

  console.log(`\n[build-overlays] === ${name} ===`);
  console.log(`[build-overlays] build v ${src}`);
  execSync(`${npm} run build`, { cwd: src, stdio: "inherit" });

  const dist = path.join(src, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error(`[build-overlays] Build '${name}' nevytvořil dist/index.html (${dist}).`);
    process.exit(1);
  }

  const dest = path.join(AGENT_ROOT, "overlays", name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(dist, dest, { recursive: true });
  console.log(`[build-overlays] zkopírováno → ${dest}`);
}

console.log("\n[build-overlays] Hotovo. Overlaye poběží na /overlay/ingame a /overlay/pickban.");
