import type {
  AllGameData,
  DragonType,
  GameObjectives,
  ObjectiveKill,
  ObjectiveKind,
  RiotEvent,
  RiotPlayer,
  Side,
  TeamObjectives,
} from "../types.js";
import { playerName, sideOf } from "./normalize.js";

/**
 * Objektivy a pentakilly z event streamu Riot Live Client API.
 *
 * Live API je tu hlavní zdroj i ve chvíli, kdy statistiky hráčů bere Agent
 * z LeagueBroadcastu: jeho eventy jsou zdokumentované, kumulativní (každý
 * poll vrací celou historii hry s `EventID`) a nesou i typ draka a krádež.
 * Všechno se proto počítá vždy znovu z celého seznamu — opakované čtení nebo
 * výpadek pollu nic nezdvojí ani neztratí.
 *
 * Strana objektivu:
 *   - draci, baroni, heraldi, voidgrubi, Atakhan → strana zabijáka (nebo
 *     prvního asistujícího hráče, když zabiják hráč není),
 *   - věže a inhibitory → podle jména budovy. `_T1_` je budova modrých
 *     (ORDER), takže bod dostává **červená** strana, a naopak. Zabiják tu
 *     bývá minion, podle něj stranu určit nejde.
 */

const DRAGON_TYPES: Record<string, DragonType> = {
  fire: "fire",
  earth: "earth",
  water: "water",
  air: "air",
  hextech: "hextech",
  chemtech: "chemtech",
  elder: "elder",
};

const EPIC_EVENTS: Record<string, ObjectiveKind> = {
  DragonKill: "dragon",
  BaronKill: "baron",
  HeraldKill: "herald",
  HordeKill: "voidgrub",
  AtakhanKill: "atakhan",
};

export function emptyTeamObjectives(): TeamObjectives {
  return {
    dragons: 0,
    dragonTypes: { fire: 0, earth: 0, water: 0, air: 0, hextech: 0, chemtech: 0, elder: 0 },
    dragonSoul: null,
    barons: 0,
    heralds: 0,
    voidgrubs: 0,
    atakhans: 0,
    towers: 0,
    inhibitors: 0,
  };
}

export function emptyObjectives(): GameObjectives {
  return {
    teams: { BLUE: emptyTeamObjectives(), RED: emptyTeamObjectives() },
    timeline: [],
    firstDragon: null,
    firstBaron: null,
    firstTower: null,
  };
}

/** Strana hráče podle jména z eventu (Riot ID game name, summoner name i champion). */
function sideOfName(players: RiotPlayer[], name: unknown): Side | null {
  if (typeof name !== "string" || !name) return null;
  const player = players.find(
    (p) =>
      playerName(p) === name ||
      p.summonerName === name ||
      p.riotId === name ||
      p.riotIdGameName === name ||
      p.championName === name,
  );
  return player ? sideOf(player.team) : null;
}

function epicSide(players: RiotPlayer[], event: RiotEvent): Side | null {
  const killer = sideOfName(players, event.KillerName);
  if (killer) return killer;
  const assisters = Array.isArray(event.Assisters) ? event.Assisters : [];
  for (const name of assisters) {
    const side = sideOfName(players, name);
    if (side) return side;
  }
  return null;
}

/** `Turret_T1_L_03_A` / `Barracks_T2_C1` → strana, která budovu zbourala. */
function structureSide(name: unknown): Side | null {
  if (typeof name !== "string") return null;
  if (/_T1_/.test(name)) return "RED";
  if (/_T2_/.test(name)) return "BLUE";
  return null;
}

function isStolen(value: unknown): boolean {
  return value === true || value === "True" || value === "true";
}

/** Normalizuje objektivy z celého event streamu Live API. */
export function objectivesFromEvents(data: AllGameData): GameObjectives {
  const players = data.allPlayers ?? [];
  const events = [...(data.events?.Events ?? [])].sort((a, b) => a.EventTime - b.EventTime);
  const result = emptyObjectives();

  for (const event of events) {
    let kill: ObjectiveKill | null = null;

    const epic = EPIC_EVENTS[event.EventName];
    if (epic) {
      const side = epicSide(players, event);
      if (!side) continue;
      const dragonType =
        epic === "dragon"
          ? (DRAGON_TYPES[String(event.DragonType ?? "").toLowerCase()] ?? null)
          : null;
      kill = {
        eventId: event.EventID,
        kind: epic,
        side,
        gameTime: event.EventTime,
        killer: typeof event.KillerName === "string" ? event.KillerName : null,
        dragonType,
        stolen: isStolen(event.Stolen),
      };
    } else if (event.EventName === "TurretKilled" || event.EventName === "InhibKilled") {
      const structure = event.EventName === "TurretKilled" ? event.TurretKilled : event.InhibKilled;
      const side = structureSide(structure);
      if (!side) continue;
      kill = {
        eventId: event.EventID,
        kind: event.EventName === "TurretKilled" ? "tower" : "inhibitor",
        side,
        gameTime: event.EventTime,
        killer: typeof event.KillerName === "string" ? event.KillerName : null,
        dragonType: null,
        stolen: false,
        structure: typeof structure === "string" ? structure : undefined,
      };
    }

    if (!kill) continue;
    result.timeline.push(kill);
    addKill(result, kill);
  }

  return result;
}

function addKill(result: GameObjectives, kill: ObjectiveKill): void {
  const team = result.teams[kill.side];
  switch (kill.kind) {
    case "dragon": {
      team.dragons += 1;
      if (kill.dragonType) team.dragonTypes[kill.dragonType] += 1;
      // Duši dává čtvrtý elementální drak týmu; od třetího draka hry už se
      // spawnuje jen drak mapy, takže typ čtvrtého je i typ duše.
      const elemental = team.dragons - team.dragonTypes.elder;
      if (kill.dragonType && kill.dragonType !== "elder" && elemental === 4 && !team.dragonSoul) {
        team.dragonSoul = kill.dragonType;
      }
      result.firstDragon ??= kill.side;
      break;
    }
    case "baron":
      team.barons += 1;
      result.firstBaron ??= kill.side;
      break;
    case "herald":
      team.heralds += 1;
      break;
    case "voidgrub":
      team.voidgrubs += 1;
      break;
    case "atakhan":
      team.atakhans += 1;
      break;
    case "tower":
      team.towers += 1;
      result.firstTower ??= kill.side;
      break;
    case "inhibitor":
      team.inhibitors += 1;
      break;
  }
}

/**
 * Pentakilly podle strany a championa.
 *
 * Klíč není jméno hráče: Live API a LeagueBroadcast jména píšou různě
 * (`Jméno` vs. `Jméno#TAG`, display name), champion na straně je ale v jedné
 * hře jednoznačný a sedí v obou zdrojích.
 */
export function pentakillsByChampion(data: AllGameData): Map<string, number> {
  const players = data.allPlayers ?? [];
  const out = new Map<string, number>();
  for (const event of data.events?.Events ?? []) {
    if (event.EventName !== "Multikill" || (event.KillStreak ?? 0) < 5) continue;
    const player = players.find(
      (p) =>
        playerName(p) === event.KillerName ||
        p.summonerName === event.KillerName ||
        p.riotId === event.KillerName ||
        p.championName === event.KillerName,
    );
    if (!player) continue;
    const key = championKey(sideOf(player.team), player.championName);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

export function championKey(side: Side, championName: string): string {
  return `${side}:${championName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}
