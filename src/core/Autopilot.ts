import type { GameManager } from "./GameManager.js";
import type { Side } from "../types.js";
import { log } from "../util/logger.js";
import { fetchSchedule, reopenGame, type WebGame, type WebMatch } from "../web/WebClient.js";
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
  /** Jde se k ní vrátit (Agent ji předčasně ukončil nebo zapsal, nebo má prozatímní výsledek). */
  canReturn: boolean;
  /**
   * Výsledek zapsaný ručně jako prozatímní (vítěz a délka, statistiky
   * doplní Agent třeba z replaye). Návrat ji na webu neotevírá.
   */
  provisional: boolean;
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
      if (current.meta.pinned) return; // operátor se k hře vrátil — čeká na ni
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
      this.manager.createGame({ ...this.gameInput(next.match, next.game, this.production), previousDuration });
    } catch (error) {
      log.warn(`Autopilot hru nezaložil: ${(error as Error).message}`);
    }
  }

  /** Hra programu, jak ji Agent zakládá (týmy, strany, napojení na web). */
  private gameInput(match: WebMatch, game: WebGame, production: ProductionKey) {
    return {
      ...this.gameFields(match, game),
      gameNumber: game.number,
      production: PRODUCTION_LABEL[production],
      web: {
        gameId: game.id,
        matchId: match.id,
        label: `${match.teamA!.name} vs ${match.teamB!.name} · Game ${game.number}`,
        production,
      },
      auto: true,
    };
  }

  /**
   * Jde se k hře vrátit? Jen k hře z programu, kterou smí Agent zapsat
   * (ne anulované, ne převzaté adminem, ne v zrušeném zápase), a jen když
   * Agent právě nic nesbírá. Hra, na kterou Agent už čeká, návrat nepotřebuje.
   * Patří sem i hry s prozatímním výsledkem (spectate nešel, vítěz a délka
   * zapsané ručně) — statistiky k nim Agent doplní z replaye.
   */
  private canReturnTo(match: WebMatch, game: WebGame): boolean {
    if (match.status === "forfeit" || match.status === "cancelled" || !match.teamA || !match.teamB) return false;
    if (game.status === "annulled" || game.resultSource === "admin") return false;
    const current = this.manager.currentSession();
    if (current?.status === "LIVE") return false;
    const isCurrent = current?.meta.web?.gameId === game.id;
    if (isCurrent) return current!.status === "GAME_ENDED" || current!.status === "EXPORTED";
    // Hry s výsledkem (od Agenta i prozatímním); hry bez výsledku zakládá autopilot sám.
    return Boolean(game.winnerTeamId);
  }

  /**
   * Návrat ke hře, kterou Agent předčasně ukončil (spadl spectator,
   * restart…) a autopilot mezitím přešel dál. Web hru znovu otevře
   * (zruší předčasný výsledek), Agent ji založí znovu a čeká na data
   * z běžící hry. Autopilot ji nevymění, dokud se nedohraje a výsledek
   * není na webu — pak pokračuje programem jako dřív.
   *
   * Hru s prozatímním výsledkem (ne od Agenta) web neotevírá: jde o replay
   * dohrané hry, série i postup v playoff mají zůstat, jak jsou. Živý stav
   * k potvrzené hře web zahodí a výsledek po konci replaye ji přepíše
   * statistikami.
   */
  async returnToGame(gameId: string): Promise<void> {
    const production = this.production;
    if (!production) throw new Error("Vyber produkci.");
    let found: { match: WebMatch; game: WebGame } | null = null;
    for (const match of this.matches) {
      const game = match.games.find((g) => g.id === gameId);
      if (game) found = { match, game };
    }
    if (!found) throw new Error("Hra není v dnešním programu.");
    if (this.manager.currentSession()?.status === "LIVE") {
      throw new Error("Právě běží hra. Návrat by přepsal rozpracovaná data.");
    }
    if (!this.canReturnTo(found.match, found.game)) throw new Error("K této hře se vrátit nejde.");

    const { match, game } = found;
    if (isProvisional(game)) {
      log.info(`Hra ${match.teamA!.name} vs ${match.teamB!.name} G${game.number}: prozatímní výsledek, čekám na replay.`);
    } else if (game.winnerTeamId || game.status === "confirmed") {
      await reopenGame(game.id, production);
      log.info(`Hra ${match.teamA!.name} vs ${match.teamB!.name} G${game.number} znovu otevřená na webu.`);
    }
    this.manager.createGame({
      ...this.gameInput(match, game, production),
      previousDuration: null,
      pinned: true,
      force: true,
    });
    void this.refresh();
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
        program.push({ ...base, gameId: null, number: null, state: "pending", winner: null, canReturn: false, provisional: false });
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
        program.push({
          ...base, gameId: game.id, number: game.number, state, winner, canReturn: this.canReturnTo(match, game),
          provisional: isProvisional(game),
        });
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

/** Výsledek zapsaný mimo Agenta (ručně jako prozatímní), ne adminem. */
function isProvisional(game: WebGame): boolean {
  return Boolean(game.winnerTeamId) && game.resultSource !== "agent" && game.resultSource !== "admin";
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
