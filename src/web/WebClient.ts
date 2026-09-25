import type { ConfirmedGame } from "../types.js";
import { loadWebSettings } from "./settings.js";

/**
 * Klient API webu Infernal League pro Production Agenta.
 *
 *   GET  /api/agent/schedule?date=RRRR-MM-DD   — zápasy produkce v daný den
 *   POST /api/agent/games/{id}/result          — výsledek hry (confirmed.json)
 *   POST /api/agent/games/{id}/live            — živý stav běžící hry
 *
 * Web výsledek zapíše a hru rovnou potvrdí. Chyby rozlišujeme na
 * „zkus znovu“ (síť, 5xx) a „odmítnuto“ (4xx s českou hláškou z webu —
 * cizí produkce, výsledek převzal admin, chybí vítěz…), kde opakování
 * nepomůže.
 */

export interface WebTeam {
  id: string;
  name: string;
  tag: string | null;
}

export interface WebGame {
  id: string;
  number: number;
  status: "unconfirmed" | "confirmed" | "annulled";
  blueTeamId: string | null;
  redTeamId: string | null;
  winnerTeamId: string | null;
  durationSeconds: number | null;
  resultSource: "agent" | "admin" | null;
}

export interface WebMatch {
  id: string;
  scheduledAt: string;
  format: string;
  status: string;
  published: boolean;
  teamA: WebTeam | null;
  teamB: WebTeam | null;
  games: WebGame[];
}

export interface WebSchedule {
  production: number;
  date: string;
  matches: WebMatch[];
}

export interface SubmitResultResponse {
  gameId: string;
  matched: number;
  unmatched: unknown[];
  revision: number;
  winnerTeamId: string;
}

export class WebApiError extends Error {
  constructor(
    message: string,
    /** false = web výsledek odmítl a opakování nepomůže. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

async function request<T>(method: "GET" | "POST", pathname: string, body?: unknown): Promise<T> {
  const settings = loadWebSettings();
  if (!settings.token) throw new WebApiError("Chybí token produkce — nastav ho v Nastavení.", false);

  let response: Response;
  try {
    response = await fetch(`${settings.webUrl}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WebApiError(`Web neodpovídá (${error instanceof Error ? error.message : String(error)}).`, true);
  }

  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    const message = data.error || `Web vrátil chybu ${response.status}.`;
    throw new WebApiError(message, response.status >= 500 || response.status === 429);
  }
  return data;
}

export function fetchSchedule(date?: string): Promise<WebSchedule> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return request<WebSchedule>("GET", `/api/agent/schedule${query}`);
}

/**
 * Živý stav běžící hry: stejný tvar jako výsledek (bez vítěze) a herní čas.
 * Posílá se každých pár sekund; nepovedený pokus se neopakuje, další stav
 * přijde za chvíli sám.
 */
export async function submitLive(gameId: string, confirmed: ConfirmedGame, gameTime: number): Promise<void> {
  await request<{ ok: true }>("POST", `/api/agent/games/${encodeURIComponent(gameId)}/live`, {
    confirmed,
    gameTime,
  });
}

export async function submitResult(gameId: string, confirmed: ConfirmedGame): Promise<SubmitResultResponse> {
  const data = await request<{ ok: true; result: SubmitResultResponse }>(
    "POST",
    `/api/agent/games/${encodeURIComponent(gameId)}/result`,
    { confirmed },
  );
  return data.result;
}
