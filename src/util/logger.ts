/** Minimalistický logger. Fáze 1A – stačí konzole s časovým razítkem. */
function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export const log = {
  info: (...a: unknown[]) => console.log(`[${ts()}]`, ...a),
  warn: (...a: unknown[]) => console.warn(`[${ts()}] WARN`, ...a),
  error: (...a: unknown[]) => console.error(`[${ts()}] ERROR`, ...a),
};
