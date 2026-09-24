import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { writeJsonAtomic } from "../util/storage.js";

/**
 * Napojení na web Infernal League: adresa webu a token produkce.
 *
 * Token vystavuje admin v System / Integrations → Production Agent a patří
 * produkci (Twitch/Kick), ne člověku. Ukládá se do datové složky aplikace
 * (v Electronu userData), mimo repo i instalaci — aktualizace ho nesmaže.
 * Do dashboardu se nikdy neposílá celý, jen jeho konec.
 */

export const DEFAULT_WEB_URL = "https://infernal-league.vercel.app";

export interface WebSettings {
  webUrl: string;
  token: string | null;
}

export interface PublicWebSettings {
  webUrl: string;
  hasToken: boolean;
  tokenHint: string | null;
}

function file(): string {
  return path.join(config.paths.data, "web_settings.json");
}

export function loadWebSettings(): WebSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<WebSettings>;
    return {
      webUrl: normalizeUrl(raw.webUrl) ?? DEFAULT_WEB_URL,
      token: typeof raw.token === "string" && raw.token.trim() ? raw.token.trim() : null,
    };
  } catch {
    return { webUrl: DEFAULT_WEB_URL, token: null };
  }
}

/** Uloží nastavení. `token: undefined` nechá uložený token beze změny. */
export function saveWebSettings(input: { webUrl?: string; token?: string | null }): PublicWebSettings {
  const current = loadWebSettings();
  const next: WebSettings = {
    webUrl: normalizeUrl(input.webUrl) ?? current.webUrl,
    token: input.token === undefined ? current.token : input.token?.trim() || null,
  };
  writeJsonAtomic(file(), next);
  return toPublic(next);
}

export function publicWebSettings(): PublicWebSettings {
  return toPublic(loadWebSettings());
}

function toPublic(settings: WebSettings): PublicWebSettings {
  return {
    webUrl: settings.webUrl,
    hasToken: Boolean(settings.token),
    tokenHint: settings.token ? settings.token.slice(-4) : null,
  };
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
