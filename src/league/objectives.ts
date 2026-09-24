import type {
  AllGameData,
  BroadcastGameEvent,
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
 * Objektivy a pentakilly z event streamu Riot Live Client API a z LeagueBroadcastu.
 *
 * Sledují se jen **draci (s typem), baroni a věže** — heraldi, voidgrubi,
 * inhibitory a Atakhan zatím nejsou potřeba (rozhodnutí 24. 9. 2026).
 *
 * Live API je kumulativní (každý poll vrací celou historii hry s `EventID`),
 * takže se z něj všechno počítá vždy znovu z celého seznamu — opakované čtení
 * nebo výpadek pollu nic nezdvojí ani neztratí.
 *
 * Strana objektivu:
 *   - draci a baroni → strana zabijáka (nebo prvního asistujícího hráče,
 *     když zabiják hráč není),
 *   - věže → podle jména budovy. Věž modrých (ORDER) dává bod **červené**
 *     straně a naopak. Zabiják tu bývá minion, podle něj stranu určit nejde.
 *
 * Co Live API ve spectatoru hlásí (ověřeno 24. 9. 2026 na záznamu hry):
 * ChampionKill, Multikill, FirstBrick, TurretKilled, InhibKilled, Ace
 * a GameEnd. **Draky ani barony nehlásí vůbec** — ty dodává LeagueBroadcast.
 * Věže se jmenují `Turret_TOrder_L1_P3_…`; starší tvar `Turret_T1_…` se
 * pořád bere taky.
 */

/** Kategorie objektivů, které se mezi zdroji nesčítají, ale vybírají. */
export const STRUCTURE_KINDS: readonly ObjectiveKind[] = ["tower"];
export const EPIC_KINDS: readonly ObjectiveKind[] = ["dragon", "baron"];

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
};

export function emptyTeamObjectives(): TeamObjectives {
  return {
    dragons: 0,
    dragonTypes: { fire: 0, earth: 0, water: 0, air: 0, hextech: 0, chemtech: 0, elder: 0 },
    dragonSoul: null,
    barons: 0,
    towers: 0,
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

/** Jméno věže → strana, která ji zbourala (věž modrých = bod pro červené). */
export function structureSide(name: unknown): Side | null {
  if (typeof name !== "string") return null;
  if (/_(T1|TOrder)_/i.test(name)) return "RED";
  if (/_(T2|TChaos)_/i.test(name)) return "BLUE";
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
    } else if (event.EventName === "TurretKilled") {
      const side = structureSide(event.TurretKilled);
      if (!side) continue;
      kill = {
        eventId: event.EventID,
        kind: "tower",
        side,
        gameTime: event.EventTime,
        killer: typeof event.KillerName === "string" ? event.KillerName : null,
        dragonType: null,
        stolen: false,
        structure: typeof event.TurretKilled === "string" ? event.TurretKilled : undefined,
      };
    }

    if (!kill) continue;
    result.timeline.push(kill);
    addKill(result, kill);
  }

  return result;
}

/** Součty a první objektivy z libovolného seznamu zabití (seřadí se podle času). */
export function tallyObjectives(kills: ObjectiveKill[]): GameObjectives {
  const result = emptyObjectives();
  for (const kill of [...kills].sort((a, b) => a.gameTime - b.gameTime)) {
    result.timeline.push(kill);
    addKill(result, kill);
  }
  return result;
}

/*
 * Objektivy z LeagueBroadcastu.
 *
 * Eventy vypadají takhle (zkušební spectaty 24. 9. 2026):
 *
 *   objective:   { objective: "DRAGON_WATER", eventType: "Kill", killer: "Jméno#TAG", team: 1 }
 *   team.update: { teamId: 1, platesTaken: 0, turretsTaken: 1, inhibitorsTaken: 0 }
 *
 * `team` 1 je modrá strana (ověřeno podle jungla, který draky zabíjel),
 * `turretsTaken` je přírůstek jedné události, ne součet. Krádež LeagueBroadcast
 * nehlásí. Ostatní objektivy (GRUB, HERALD, ATAKHAN, inhibitory) se ignorují.
 */
const BROADCAST_OBJECTIVES: Record<string, { kind: ObjectiveKind; dragonType: DragonType | null }> = {
  BARON: { kind: "baron", dragonType: null },
  DRAGON_FIRE: { kind: "dragon", dragonType: "fire" },
  DRAGON_EARTH: { kind: "dragon", dragonType: "earth" },
  DRAGON_WATER: { kind: "dragon", dragonType: "water" },
  DRAGON_AIR: { kind: "dragon", dragonType: "air" },
  DRAGON_HEXTECH: { kind: "dragon", dragonType: "hextech" },
  DRAGON_CHEMTECH: { kind: "dragon", dragonType: "chemtech" },
  DRAGON_ELDER: { kind: "dragon", dragonType: "elder" },
  DRAGON_CLASSIC: { kind: "dragon", dragonType: null },
};

function broadcastSide(team: unknown): Side | null {
  if (team === 1 || team === 100 || team === "ORDER") return "BLUE";
  if (team === 2 || team === 200 || team === "CHAOS") return "RED";
  return null;
}

/**
 * Objektivy z jednoho LeagueBroadcast eventu. `nextId` dává záporná ID, ať se
 * nepletou s `EventID` z Live API.
 */
export function objectivesFromBroadcastEvent(
  event: BroadcastGameEvent,
  nextId: () => number,
): ObjectiveKill[] {
  const payload = event.payload as Record<string, unknown>;
  const gameTime = event.gameTime ?? 0;

  if (event.type === "objective") {
    if (String(payload.eventType ?? "").toLowerCase() !== "kill") return [];
    const known = BROADCAST_OBJECTIVES[String(payload.objective ?? "").toUpperCase()];
    const side = broadcastSide(payload.team);
    if (!known || !side) return [];
    return [{
      eventId: nextId(),
      kind: known.kind,
      side,
      gameTime,
      killer: typeof payload.killer === "string" ? payload.killer : null,
      dragonType: known.dragonType,
      stolen: false,
    }];
  }

  if (event.type === "team.update") {
    const side = broadcastSide(payload.teamId);
    const count = typeof payload.turretsTaken === "number" ? payload.turretsTaken : 0;
    if (!side || count <= 0) return [];
    return Array.from({ length: count }, () => ({
      eventId: nextId(),
      kind: "tower" as const,
      side,
      gameTime,
      killer: null,
      dragonType: null,
      stolen: false,
    }));
  }

  return [];
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
    case "tower":
      team.towers += 1;
      result.firstTower ??= kill.side;
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
