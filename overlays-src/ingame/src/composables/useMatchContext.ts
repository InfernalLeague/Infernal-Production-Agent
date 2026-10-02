import { ref, onMounted, onUnmounted, type Ref } from 'vue'

// ── Data zápasu z webu Infernal League ──────────────────────────────────────
// Overlay je servírovaný Production Agentem (/overlay/ingame) a agent mu na
// /api/overlay předává data hry, kterou právě sleduje: týmy podle stran
// (název, tag, logo, bilance, skóre série), hráče se šampiony z Champion
// Draftu, název splitu, týden nebo kolo play-off, další zápas večera
// a obrázky do L-Framu. Token produkce zůstává v agentovi, v OBS není klíč.
//
// Herní statistiky dál chodí z LeagueBroadcastu. Odsud je jen to, co hra sama
// neví — kdo je kdo. Bez napojené hry je `context` null a overlay se vrátí
// k tomu, co o týmech hlásí LeagueBroadcast.
//
// Tvar odpovídá `OverlayContext` v webovém repu (src/lib/agent/overlay.ts).

export interface OverlayTeam {
  id: string
  name: string
  tag: string | null
  logoUrl: string | null
  record: { wins: number; losses: number; position: number | null }
  seriesWins: number
}

export interface OverlayPlayer {
  playerId: string
  nick: string
  role: string
  championKey: string | null
}

export interface OverlayBriefTeam {
  name: string
  tag: string | null
  logoUrl: string | null
}

export interface OverlayContext {
  gameId: string
  matchId: string
  splitName: string | null
  stage: string | null
  format: string
  bestOf: number
  gameNumber: number
  blue: OverlayTeam | null
  red: OverlayTeam | null
  players: { blue: OverlayPlayer[]; red: OverlayPlayer[] }
  nextMatch: { scheduledAt: string | null; teamA: OverlayBriefTeam; teamB: OverlayBriefTeam } | null
  slides: Array<{ id: string; url: string; name: string }>
}

const REFRESH_MS = 4_000

const MOCK = new URLSearchParams(location.search).has('mock')
  || (import.meta.env.DEV && import.meta.env.VITE_MOCK !== 'false')

// Jedna sdílená smyčka pro všechny komponenty — scoreboard, spodní panel,
// L-Frame i panel u minimapy čtou stejná data a agent dostane jeden dotaz.
const context = ref<OverlayContext | null>(MOCK ? mockContext() : null)
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

async function refresh(): Promise<void> {
  try {
    const response = await fetch('/api/overlay', { cache: 'no-store' })
    if (!response.ok) return
    const data = (await response.json()) as { context: OverlayContext | null }
    context.value = data.context
  } catch {
    // Agent na chvíli neodpovídá — necháme poslední data, další pokus za chvíli.
  }
}

export function useMatchContext(): Ref<OverlayContext | null> {
  onMounted(() => {
    if (subscribers === 0 && !MOCK) {
      void refresh()
      timer = setInterval(refresh, REFRESH_MS)
    }
    subscribers++
  })

  onUnmounted(() => {
    subscribers--
    if (subscribers <= 0) {
      subscribers = 0
      if (timer !== null) { clearInterval(timer); timer = null }
    }
  })

  return context
}

/** Klíč šampiona bez rozdílů v zápisu („MonkeyKing" ~ „monkeyking", „Kai'Sa" ~ „kaisa"). */
export function championId(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Přezdívka hráče na pozici `slot` jedné strany.
 *
 * Přednost má šampion: Champion Draft ví, kterému hráči šampion patří,
 * a LeagueBroadcast ví, kdo kterého hraje — sedí to i při náhradnících
 * a prohozených rolích. Když přiřazení chybí, platí pořadí rolí (top → support),
 * ale jen pro kompletní pětici, jinak by se jména posunula.
 */
export function nickFor(
  players: OverlayPlayer[] | undefined,
  slot: number,
  championAlias: string | null | undefined,
): string {
  if (!players?.length) return ''
  const alias = championId(championAlias)
  if (alias) {
    const byChampion = players.find((p) => championId(p.championKey) === alias)
    if (byChampion) return byChampion.nick
  }
  return players.length === 5 ? (players[slot]?.nick ?? '') : ''
}

/** Ukázková data pro `?mock` (adresou jdou přepsat názvy týmů a formát). */
function mockContext(): OverlayContext {
  const params = new URLSearchParams(location.search)
  const bestOf = Number(params.get('bo') ?? 5)
  const nicks = (prefix: string) =>
    ['Top', 'Jungle', 'Mid', 'Adc', 'Support'].map((role, i) => ({
      playerId: `${prefix}-${i}`,
      nick: `${prefix}${role}`,
      role: role.toLowerCase(),
      championKey: null,
    }))
  const team = (id: string, name: string, tag: string, wins: number, losses: number, position: number, seriesWins: number): OverlayTeam => ({
    id, name, tag, logoUrl: null, record: { wins, losses, position }, seriesWins,
  })
  return {
    gameId: 'mock',
    matchId: 'mock',
    splitName: 'SPLIT 0.5',
    stage: bestOf > 1 ? 'Čtvrtfinále' : '3. týden',
    format: `BO${bestOf}`,
    bestOf,
    gameNumber: bestOf > 1 ? 3 : 1,
    blue: team('b', params.get('blue') ?? 'HELLFIRE', 'HELL', 5, 1, 2, bestOf > 1 ? 2 : 0),
    red: team('r', params.get('red') ?? 'OBSIDIAN', 'OBS', 4, 2, 5, bestOf > 1 ? 1 : 0),
    players: { blue: nicks('Hell'), red: nicks('Obs') },
    nextMatch: {
      scheduledAt: new Date(Date.now() + 75 * 60_000).toISOString(),
      teamA: { name: 'PYRO', tag: 'PYRO', logoUrl: null },
      teamB: { name: 'SMOLDER', tag: 'SMO', logoUrl: null },
    },
    slides: [{ id: 'dev', url: '/dev-bg.png', name: 'Ukázka' }],
  }
}
