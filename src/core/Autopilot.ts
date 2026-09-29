import type { GameManager } from "./GameManager.js";
import type { Side } from "../types.js";
import { log } from "../util/logger.js";
import { fetchSchedule, type WebGame, type WebMatch } from "../web/WebClient.js";
import {
  adoptLegacyToken,
  loadWebSettings,
  PRODUCTION_NUMBER,
  setActiveProduction,
  tokenFor,
  type ProductionKey,
} from "../web/settings.js";

/** Jak často se program stahuje znovu. Hry série vznikají na webu až po zápisu vítěze. */
const REFRESH_MS = 15_000;
/** Po zápisu výsledku: web mezitím založil další hru série. */
const AFTER_RESULT_MS = 1_500;

const TIMEZONE = "Europe/Prague";
const PRODUCTION_LABEL: Record<ProductionKey, string> = { twitch: "Twitch", kick: "Kick" };
const CLOSED_MATCH = new Set(["finished", "forfeit", "cancelled"]);

/** Jedna hra programu, jak ji vidí dashboard. */
interface ProgramGame {
  matchId: string;
  gameId: string | null;
  number: number | null;
  scheduledAt: string;
  teamA: string;
  teamB: string;
  format: string;
  published: boolean;
  /** done = má vítěze, current = právě ji Agent sbírá, next = na řadě, upcoming = později. */
  state: "done" | "current" | "next" | "upcoming" | "annulled" | "admin" | "pending";
  winner: string | null;
}

/**
 * Autopilot: program produkce → hry v Agentovi bez ručního zakládání.
 *
 * Po výběru produkce si Agent tokenem té produkce stáhne dnešní program
 * a první nedohranou hru založí sám (čeká na start). Start i konec hry
 * pozná GameManager jako dosud, vítěze odhadne a výsledek zapíše na web.
 * Web po zápisu vítěze založí další hru série; autopilot ji při dalším
 * načtení programu najde a připraví. Po poslední hře série přejde na
 * první hru dalšího zápasu.
 *
 * Operátor jen kontroluje vítěze: odhad potvrdí nebo přepne na druhý tým.
 * Předchozí hru jde opravit, i když už Agent čeká na další.
 */
export class Autopilot {
  private enabled = true;
  private production: ProductionKey | null = null;
  private matches: WebMatch[] = [];
  private loading = false;
  private error: string | null = null;
  private fetchedAt: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private soon: NodeJS.Timeout | null = null;

  constructor(private readonly manager: GameManager) {
    manager.setAutopilotState(() => this.getState());
    manager.on("resultSynced", () => this.refreshSoon(AFTER_RESULT_MS));
  }

  start(): void {
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  setProduction(production: ProductionKey | null): void {
    if (production === this.production) return;
    this.production = production;
    setActiveProduction(production);
    this.matches = [];
    this.error = null;
    this.fetchedAt = null;
    log.info(`Produkce: ${production ? PRODUCTION_LABEL[production] : "žádná"}`);
    void this.refresh();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    log.info(`Autopilot ${enabled ? "zapnutý" : "vypnutý"}`);
    if (enabled) void this.refresh();
    else this.manager.notify();
  }

  /** Token se v nastavení změnil → hned načíst znovu. */
  settingsChanged(): void {
    void this.refresh();
  }

  private refreshSoon(delay: number): void {
    if (this.soon) clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.refresh(), delay);
  }

  async refresh(): Promise<void> {
    const production = this.production;
    if (!production || this.loading) return;
    if (!tokenFor(production)) {
      this.error = `Chybí token produkce ${PRODUCTION_LABEL[production]} — vlož ho v ⚙ Web.`;
      this.matches = [];
      this.manager.notify();
      return;
    }

    this.loading = true;
    try {
      const matches: WebMatch[] = [];
      for (const date of programDates()) {
        const schedule = await fetchSchedule(date, production);
        if (schedule.production !== PRODUCTION_NUMBER[production]) {
          throw new Error(
            `Token patří produkci ${schedule.production === 2 ? "Kick" : "Twitch"}, ne ${PRODUCTION_LABEL[production]}. Oprav ho v ⚙ Web.`,
          );
        }
        matches.push(...schedule.matches);
      }
      // Starý jediný token: web právě potvrdil, které produkci patří.
      const legacy = loadWebSettings().legacyToken;
      if (legacy && tokenFor(production) === legacy) adoptLegacyToken(legacy, production);

      if (this.production !== production) return; // mezitím se přepnulo
      this.matches = matches.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      if (this.error) log.info("Program produkce se znovu načítá.");
      this.error = null;
      this.fetchedAt = new Date().toISOString();
      this.advance();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== this.error) log.warn(`Program produkce se nenačetl: ${message}`);
      this.error = message;
    } finally {
      this.loading = false;
      this.manager.notify();
    }
  }

  /** První hra programu, která ještě nemá výsledek a Agent ji smí zapsat. */
  private nextGame(): { match: WebMatch; game: WebGame } | null {
    for (const match of this.matches) {
      if (CLOSED_MATCH.has(match.status) || !match.teamA || !match.teamB) continue;
      const games = [...match.games].sort((a, b) => a.number - b.number);
      for (const game of games) {
        if (game.status === "annulled" || game.winnerTeamId || game.resultSource === "admin") continue;
        return { match, game };
      }
    }
    return null;
  }

  /**
   * Připraví v Agentovi hru, která je v programu na řadě.
   *
   * Běžící hru nikdy nepřeruší. Hru, která ještě nezačala, jen doplní
   * (strany z draftu) nebo vymění, když se program pohnul (admin hru
   * zapsal sám). Dohranou hru nahradí, až je výsledek na webu.
   */
  private advance(): void {
    if (!this.enabled || !this.production) return;
    const next = this.nextGame();
    const current = this.manager.currentSession();
    const status = current?.status;

    if (status === "LIVE") return;
    if (current && (status === "WAITING_FOR_GAME" || status === "CREATED")) {
      if (!current.meta.auto) return; // hru založil operátor ručně — nesahat
      if (!next) return;
      if (current.meta.web?.gameId === next.game.id) {
        this.manager.updateWaitingGame(this.gameFields(next.match, next.game));
        return;
      }
    }
    if (!next || !this.manager.canReplaceSession()) return;
    // Dohraná hra, jejíž výsledek web ještě nepromítl do programu.
    if (current?.meta.web?.gameId === next.game.id) return;

    const previousDuration =
      current && current.status !== "WAITING_FOR_GAME" && current.status !== "CREATED"
        ? current.finalSnapshot?.durationSeconds ?? null
        : current?.meta.previousDuration ?? null;
    try {
      this.manager.createGame({
        ...this.gameFields(next.match, next.game),
        gameNumber: next.game.number,
        production: PRODUCTION_LABEL[this.production],
        web: {
          gameId: next.game.id,
          matchId: next.match.id,
          label: `${next.match.teamA!.name} vs ${next.match.teamB!.name} · Game ${next.game.number}`,
          production: this.production,
        },
        auto: true,
        previousDuration,
      });
    } catch (error) {
      log.warn(`Autopilot hru nezaložil: ${(error as Error).message}`);
    }
  }

  private gameFields(match: WebMatch, game: WebGame) {
    const teamA = match.teamA!;
    const format = String(match.format || "").toUpperCase();
    // Strany podle hry na webu (volba strany / Champion Draft); jinak tým A modrá.
    const team1Side: Side = game.redTeamId === teamA.id ? "RED" : "BLUE";
    return {
      team1: teamA.name,
      team2: match.teamB!.name,
      team1Side,
      seriesFormat: ["BO1", "BO3", "BO5"].includes(format) ? format : format || "BO1",
    };
  }

  getState() {
    const current = this.manager.currentSession();
    const next = this.nextGame();
    const program: ProgramGame[] = [];
    for (const match of this.matches) {
      const base = {
        matchId: match.id,
        scheduledAt: match.scheduledAt,
        teamA: match.teamA?.name ?? "?",
        teamB: match.teamB?.name ?? "?",
        format: match.format,
        published: match.published,
      };
      if (match.games.length === 0) {
        program.push({ ...base, gameId: null, number: null, state: "pending", winner: null });
        continue;
      }
      for (const game of [...match.games].sort((a, b) => a.number - b.number)) {
        const winner =
          game.winnerTeamId === match.teamA?.id ? match.teamA.name
          : game.winnerTeamId === match.teamB?.id ? match.teamB.name
          : null;
        const isCurrent = current?.meta.web?.gameId === game.id && current.status !== "EXPORTED";
        const state: ProgramGame["state"] =
          isCurrent && !winner ? "current"
          : game.status === "annulled" ? "annulled"
          : winner ? "done"
          : game.resultSource === "admin" ? "admin"
          : next?.game.id === game.id ? "next"
          : "upcoming";
        program.push({ ...base, gameId: game.id, number: game.number, state, winner });
      }
    }
    return {
      enabled: this.enabled,
      production: this.production,
      loading: this.loading,
      error: this.error,
      fetchedAt: this.fetchedAt,
      program,
      nextLabel: next ? `${next.match.teamA!.name} vs ${next.match.teamB!.name} · Game ${next.game.number}` : null,
    };
  }
}

/** Dnešní den v Praze; po půlnoci (do 6:00) i včerejšek — zápas mohl přetáhnout. */
function programDates(): string[] {
  const now = new Date();
  const day = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hourCycle: "h23" }).format(now),
  );
  const today = day(now);
  if (hour >= 6) return [today];
  return [day(new Date(now.getTime() - 24 * 60 * 60 * 1000)), today];
}
