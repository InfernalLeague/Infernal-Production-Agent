// Vygeneruje build/icon.ico (multi-size) z loga ligy pro balení (.exe/installer)
// a public/favicon.png pro dashboard. Zdroj: build/il-logo.png.
// Spusť: node scripts/make-icon.mjs

import pngToIco from "png-to-ico";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOGO = process.env.LOGO_PNG ?? path.join(ROOT, "build", "il-logo.png");

if (!fs.existsSync(LOGO)) {
  console.error(`[make-icon] Logo nenalezeno: ${LOGO}`);
  process.exit(1);
}

fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
const icoPath = path.join(ROOT, "build", "icon.ico");

const ico = await pngToIco(LOGO);
fs.writeFileSync(icoPath, ico);
console.log(`[make-icon] Zapsáno ${icoPath} (${(ico.length / 1024).toFixed(1)} kB)`);

// Favicon pro dashboard – použijeme rovnou logo PNG (prohlížeč si zmenší).
fs.copyFileSync(LOGO, path.join(ROOT, "public", "logo.png"));
console.log(`[make-icon] Zkopírováno logo → public/logo.png`);
