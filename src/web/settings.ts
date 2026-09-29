import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { writeJsonAtomic } from "../util/storage.js";

/**
 * Napojení na web Infernal League: adresa webu a tokeny produkcí.
 *
 * Token vystavuje admin v System / Integrations → Production Agent a patří
 * produkci (Twitch/Kick), ne člověku. Agent drží token pro každou produkci
 * zvlášť a používá ten, jehož produkci operátor vybral — podle něj web
 * vrací program i přijímá výsledky. Ukládá se do datové složky aplikace
 * (v Electronu userData), mimo repo i instalaci — aktualizace ho nesmaže.
 * Do dashboardu se nikdy neposílá celý, jen jeho konec.
 */

export const DEFAULT_WEB_URL = "https://infernal-league.vercel.app";

export type ProductionKey = "twitch" | "kick";
export const PRODUCTION_KEYS: ProductionKey[] = ["twitch", "kick"];

/** Číslo produkce na webu (`matches.production`). */
export const PRODUCTION_NUMBER: Record<ProductionKey, number> = { twitch: 1, kick: 2 };

export function productionKeyOf(value: unknown): ProductionKey | null {
  return value === "twitch" || value === "kick" ? value : null;
}

export interface WebSettings {
  webUrl: string;
  tokens: Record<ProductionKey, string | null>;
  /**
   * Token z verzí do 0.1.20, kdy byl jen jeden. Nevíme, které produkci
   * patří — slouží jako záloha pro produkci bez vlastního tokenu a první
   * odpověď webu (`production` v programu) ho zařadí.
   */
  legacyToken: string | null;
}

export interface PublicWebSettings {
  webUrl: string;
  /** Má aktivní produkce token? */
  hasToken: boolean;
  tokenHint: string | null;
  production: ProductionKey | null;
  tokens: Record<ProductionKey, { hasToken: boolean; tokenHint: string | null }>;
}

/** Produkce vybraná v dashboardu. Jen v paměti — dashboard ji po startu pošle sám. */
let activeProduction: ProductionKey | null = null;

export function setActiveProduction(production: ProductionKey | null): void {
  activeProduction = production;
}

export function getActiveProduction(): ProductionKey | null {
  return activeProduction;
}

function file(): string {
  return path.join(config.paths.data, "web_settings.json");
}

const clean = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function loadWebSettings(): WebSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as {
      webUrl?: unknown;
      token?: unknown;
      tokens?: Partial<Record<ProductionKey, unknown>>;
    };
    return {
      webUrl: normalizeUrl(raw.webUrl) ?? DEFAULT_WEB_URL,
      tokens: { twitch: clean(raw.tokens?.twitch), kick: clean(raw.tokens?.kick) },
      legacyToken: clean(raw.token),
    };
  } catch {
    return { webUrl: DEFAULT_WEB_URL, tokens: { twitch: null, kick: null }, legacyToken: null };
  }
}

/** Token pro produkci (bez argumentu = aktivní). Starý jediný token slouží jako záloha. */
export function tokenFor(production?: ProductionKey | null): string | null {
  const settings = loadWebSettings();
  const key = production ?? activeProduction;
  return (key && settings.tokens[key]) || settings.legacyToken;
}

/**
 * Uloží nastavení. `undefined` nechá hodnotu beze změny, prázdný řetězec
 * token smaže.
 */
export function saveWebSettings(input: {
  webUrl?: string;
  tokens?: Partial<Record<ProductionKey, string | null>>;
}): PublicWebSettings {
  const current = loadWebSettings();
  const tokens = { ...current.tokens };
  for (const key of PRODUCTION_KEYS) {
    const value = input.tokens?.[key];
    if (value !== undefined) tokens[key] = clean(value);
  }
  write({ webUrl: normalizeUrl(input.webUrl) ?? current.webUrl, tokens, legacyToken: current.legacyToken });
  return publicWebSettings();
}

/** Web potvrdil, které produkci starý token patří: zařadí se k ní. */
export function adoptLegacyToken(token: string, production: ProductionKey): void {
  const current = loadWebSettings();
  if (current.legacyToken !== token || current.tokens[production]) return;
  write({ ...current, tokens: { ...current.tokens, [production]: token }, legacyToken: null });
}

function write(settings: WebSettings): void {
  writeJsonAtomic(file(), {
    webUrl: settings.webUrl,
    tokens: settings.tokens,
    ...(settings.legacyToken ? { token: settings.legacyToken } : {}),
  });
}

export function publicWebSettings(): PublicWebSettings {
  const settings = loadWebSettings();
  const hint = (token: string | null) => ({ hasToken: Boolean(token), tokenHint: token ? token.slice(-4) : null });
  const active = tokenFor();
  return {
    webUrl: settings.webUrl,
    ...hint(active),
    production: activeProduction,
    tokens: { twitch: hint(settings.tokens.twitch), kick: hint(settings.tokens.kick) },
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
