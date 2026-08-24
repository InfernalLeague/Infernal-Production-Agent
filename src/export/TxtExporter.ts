import type { ConfirmedGame, ConfirmedPlayer, Side, ValueSource } from "../types.js";

/**
 * TxtExporter (workflow §42, §47): převede ConfirmedGame na STROJOVĚ ČITELNÝ TXT
 * se stabilní strukturou (klíč=hodnota), ne na větu pro člověka (§43).
 *
 * `includeSources` (default true pro testovací verzi §47): ke každé spojované
 * statistice přidá i `*_source` (live / screenshot / verified / manual).
 * Prázdná hodnota = null (např. damage/gold bez screenshotu).
 */
export class TxtExporter {
  constructor(private readonly includeSources = true) {}

  export(game: ConfirmedGame): string {
    const L: string[] = [];
    const g = game.game;

    L.push("GAME");
    L.push(`local_game_id=${g.localGameId}`);
    L.push(`team1=${g.team1}`);
    L.push(`team2=${g.team2}`);
    L.push(`game_number=${g.gameNumber}`);
    L.push(`series=${g.seriesFormat}`);
    if (g.production) L.push(`production=${g.production}`);
    L.push(`duration=${formatDuration(g.durationSeconds)}`);
    L.push(`duration_seconds=${g.durationSeconds ?? ""}`);
    L.push(`winner=${g.winner ?? ""}`);
    L.push(`first_blood_player=${g.firstBloodPlayer ?? ""}`);
    L.push(`first_blood_team=${g.firstBloodTeam ?? ""}`);
    L.push(`created_at=${g.createdAt}`);
    L.push(`confirmed_at=${g.confirmedAt ?? ""}`);
    L.push("");

    this.draftLines(game).forEach((line) => L.push(line));

    game.teams.forEach((t, i) => {
      L.push(`TEAM${i + 1}`);
      L.push(`name=${t.name}`);
      L.push(`side=${t.side}`);
      L.push(`kills=${num(t.kills)}`);
      L.push(`gold=${num(t.gold)}`);
      L.push("");
    });

    game.players.forEach((p, i) => {
      L.push(`PLAYER${i + 1}`);
      this.playerLines(p).forEach((line) => L.push(line));
      L.push("");
    });

    return L.join("\n").trimEnd() + "\n";
  }

  /** Sekce DRAFT: bany a picky v pořadí, po týmech (§ champ select). */
  private draftLines(game: ConfirmedGame): string[] {
    if (!game.draft) return [];
    const draft = game.draft;
    const sideOfTeam = (teamName: string): Side =>
      game.teams.find((t) => t.name === teamName)?.side ?? "BLUE";

    const bansOf = (side: Side): string =>
      draft.bans.filter((b) => b.side === side).sort((a, b) => a.order - b.order)
        .map((b) => b.championName).join(";");
    const picksOf = (side: Side): string =>
      draft.picks.filter((p) => p.side === side).sort((a, b) => a.order - b.order)
        .map((p) => p.championName).join(";");

    const s1 = sideOfTeam(game.game.team1);
    const s2 = sideOfTeam(game.game.team2);
    const out: string[] = ["DRAFT", `complete=${draft.complete}`];
    out.push(`team1_bans=${bansOf(s1)}`);
    out.push(`team2_bans=${bansOf(s2)}`);
    out.push(`team1_picks=${picksOf(s1)}`);
    out.push(`team2_picks=${picksOf(s2)}`);
    out.push("");
    return out;
  }

  private playerLines(p: ConfirmedPlayer): string[] {
    const out: string[] = [];
    out.push(`name=${p.name}`);
    out.push(`team=${p.team}`);
    out.push(`side=${p.side}`);
    out.push(`champion=${p.championName}`);
    out.push(`level=${num(p.level)}`);
    this.stat(out, "kills", p.kills, p.sources.kills);
    this.stat(out, "deaths", p.deaths, p.sources.deaths);
    this.stat(out, "assists", p.assists, p.sources.assists);
    this.stat(out, "cs", p.cs, p.sources.cs);
    this.stat(out, "vision", p.vision, p.sources.vision);
    this.stat(out, "damage", p.damage, p.sources.damage);
    this.stat(out, "gold", p.gold, p.sources.gold);
    this.stat(out, "gold_per_minute", p.goldPerMinute, p.sources.goldPerMinute);
    out.push(`pentakills=${p.pentakills}`);
    out.push(`items=${p.items.join(";")}`);
    return out;
  }

  private stat(out: string[], key: string, value: number | null, source: ValueSource): void {
    out.push(`${key}=${num(value)}`);
    if (this.includeSources) out.push(`${key}_source=${source ?? ""}`);
  }
}

function num(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Sekundy → "MM:SS" (nebo prázdné). */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
