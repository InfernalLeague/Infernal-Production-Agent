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
    L.push(`winner_source=${g.winnerSource ?? ""}`);
    L.push(`first_blood_player=${g.firstBloodPlayer ?? ""}`);
    L.push(`first_blood_team=${g.firstBloodTeam ?? ""}`);
    L.push(`first_dragon_team=${g.firstDragonTeam ?? ""}`);
    L.push(`first_baron_team=${g.firstBaronTeam ?? ""}`);
    L.push(`first_tower_team=${g.firstTowerTeam ?? ""}`);
    L.push(`created_at=${g.createdAt}`);
    L.push(`confirmed_at=${g.confirmedAt ?? ""}`);
    L.push("");

    game.teams.forEach((t, i) => {
      L.push(`TEAM${i + 1}`);
      L.push(`name=${t.name}`);
      L.push(`side=${t.side}`);
      L.push(`kills=${num(t.kills)}`);
      L.push(`gold=${num(t.gold)}`);
      L.push(`gold_diff=${num(t.goldDiff)}`);
      const o = t.objectives;
      L.push(`dragons=${o.dragons}`);
      for (const [type, count] of Object.entries(o.dragonTypes)) L.push(`dragon_${type}=${count}`);
      L.push(`dragon_soul=${o.dragonSoul ?? ""}`);
      L.push(`barons=${o.barons}`);
      L.push(`towers=${o.towers}`);
      L.push("");
    });

    if (game.objectiveTimeline.length > 0) {
      L.push("OBJECTIVES");
      // čas;objektiv;typ draka;tým;ukradený
      game.objectiveTimeline.forEach((kill) => {
        L.push(
          `${formatDuration(kill.gameTime)};${kill.kind};${kill.dragonType ?? ""};${kill.team};${kill.stolen ? "stolen" : ""}`,
        );
      });
      L.push("");
    }

    if (game.goldTimeline.length > 0) {
      L.push("GOLD");
      // čas;gold modrých;gold červených;rozdíl (modří − červení)
      game.goldTimeline.forEach((sample) => {
        L.push(`${formatDuration(sample.gameTime)};${sample.teams.BLUE};${sample.teams.RED};${sample.diff}`);
      });
      L.push("");
    }

    game.players.forEach((p, i) => {
      L.push(`PLAYER${i + 1}`);
      this.playerLines(p).forEach((line) => L.push(line));
      L.push("");
    });

    return L.join("\n").trimEnd() + "\n";
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
    out.push(`slot=${num(p.slot)}`);
    out.push(`opponent=${p.opponentChampion ?? ""}`);
    out.push(`gold_diff_at_14=${num(p.goldDiffAt14)}`);
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
