import { onUnmounted, watch, type Ref } from 'vue'
import { AnnouncementType } from '@bluebottle_gg/league-broadcast-client'
import { useClient } from '@/client'
import { championId, playerFor, type OverlayCareer, type OverlayContext } from './useMatchContext'
import type { PushBanner } from './useRowBanners'

// ── Milníky v Infernal League ───────────────────────────────────────────────
// Na řádku hráče se ukáže, když během hry:
//   – dosáhne 50., 100., 200., 300.… killu, asistence nebo smrti v lize
//     (součet z dřívějších her z webu + živé číslo ze hry),
//   – dá pentakill („PRVNÍ PENTAKILL V INFERNAL LEAGUE", pak „2. …"),
//   – hraje svou 25., 50., 75.… hru v lize (jen na začátku hry),
//   – překoná rekord ligy v killech, asistencích nebo smrtích v jedné hře
//     — až po prvních 20 hrách ligy a každý rekord jen jednou za hru.
//
// První stav řádku (i po změně championa = nová hra) je jen výchozí bod, aby
// se po refreshi overlaye nespustily milníky, které už padly.

const LOGO = 'icons/infernal-logo.png'
const RECORD_MIN_GAMES = 20
/** Milník her se ukazuje jen na začátku hry, ne po refreshi uprostřed. */
const GAME_MILESTONE_UNTIL = 120

type Stat = 'kills' | 'assists' | 'deaths'

const STAT_TITLE: Record<Stat, string> = { kills: 'KILL', assists: 'ASISTENCE', deaths: 'SMRT' }
const RECORD_TITLE: Record<Stat, string> = { kills: 'KILLY', assists: 'ASISTENCE', deaths: 'SMRTI' }

interface PanelPlayer {
  champion?: { alias?: string } | null
  kills?: number
  assists?: number
  deaths?: number
}

/** 50, pak každá stovka. */
function isMilestone(n: number): boolean {
  return n === 50 || (n >= 100 && n % 100 === 0)
}

export function useLeagueMilestones(
  blue: Ref<PanelPlayer[]>,
  red: Ref<PanelPlayer[]>,
  match: Ref<OverlayContext | null>,
  gameTime: Ref<number>,
  push: PushBanner,
): void {
  const seen = new Map<string, { alias: string; kills: number; assists: number; deaths: number }>()
  const pentas = new Map<string, number>()
  const gameMilestones = new Set<string>()
  const records = new Set<string>()

  const milestone = (key: string, title: string) =>
    push(key, { tone: 'milestone', label: 'MILNÍK', title, imageUrl: LOGO })

  function career(side: 'blue' | 'red', index: number, alias: string): { id: string; stats: OverlayCareer } | null {
    const player = playerFor(match.value?.players[side], index, alias)
    if (!player) return null
    return {
      id: player.playerId,
      stats: match.value?.league?.players[player.playerId]
        ?? { games: 0, kills: 0, deaths: 0, assists: 0, pentakills: 0 },
    }
  }

  function scan(side: 'blue' | 'red', players: PanelPlayer[]): void {
    const league = match.value?.league
    if (!league) return
    const gameId = match.value?.gameId ?? ''

    players.forEach((player, index) => {
      const key = `${side}-${index}`
      const alias = player.champion?.alias ?? ''
      const now = { alias, kills: player.kills ?? 0, assists: player.assists ?? 0, deaths: player.deaths ?? 0 }
      const prev = seen.get(key)
      seen.set(key, now)
      const who = career(side, index, alias)
      if (!who) return

      // Hra v lize: každá 25. Jen jednou za hru a jen na jejím začátku.
      const gameKey = `${gameId}-${who.id}`
      if (!gameMilestones.has(gameKey)) {
        gameMilestones.add(gameKey)
        const nth = who.stats.games + 1
        if (nth % 25 === 0 && gameTime.value <= GAME_MILESTONE_UNTIL) milestone(key, `${nth}. HRA V INFERNAL LEAGUE`)
      }

      if (!prev || prev.alias !== alias) return

      for (const stat of ['kills', 'assists', 'deaths'] as Stat[]) {
        if (now[stat] <= prev[stat]) continue
        for (let n = who.stats[stat] + prev[stat] + 1; n <= who.stats[stat] + now[stat]; n++) {
          if (isMilestone(n)) milestone(key, `${n}. ${STAT_TITLE[stat]} V INFERNAL LEAGUE`)
        }

        // Rekord ligy v jedné hře: až po 20 hrách, každý jen jednou za hru.
        const record = league.records[stat]
        const recordKey = `${gameId}-${stat}`
        if (league.records.games >= RECORD_MIN_GAMES && record != null && now[stat] > record && !records.has(recordKey)) {
          records.add(recordKey)
          push(key, { tone: 'record', label: 'NOVÝ REKORD LIGY', title: `${RECORD_TITLE[stat]} · ${now[stat]}`, imageUrl: LOGO })
        }
      }
    })
  }

  watch([blue, red], ([bluePlayers, redPlayers]) => {
    scan('blue', bluePlayers)
    scan('red', redPlayers)
  })

  // Pentakill hlásí LeagueBroadcast jako událost s championem hráče.
  const client = useClient()
  const off = client.onIngameEvents({
    onAnnouncementEvent: (event) => {
      if (event.type !== AnnouncementType.PentaKill) return
      const alias = championId(event.source?.champion?.alias)
      if (!alias) return
      for (const [side, players] of [['blue', blue.value], ['red', red.value]] as const) {
        const index = players.findIndex((p) => championId(p.champion?.alias) === alias)
        if (index < 0) continue
        const key = `${side}-${index}`
        const who = career(side, index, players[index].champion?.alias ?? '')
        const thisGame = (pentas.get(key) ?? 0) + 1
        pentas.set(key, thisGame)
        const nth = (who?.stats.pentakills ?? 0) + thisGame
        milestone(key, nth === 1 ? 'PRVNÍ PENTAKILL V INFERNAL LEAGUE' : `${nth}. PENTAKILL V INFERNAL LEAGUE`)
        return
      }
    },
  })
  onUnmounted(off)

  // Ukázkový režim: ?mock&fx=milestone střídá ukázky milníků a rekordu.
  const params = new URLSearchParams(location.search)
  if (params.has('mock') && params.get('fx') === 'milestone') {
    const samples: [string, Parameters<PushBanner>[1]][] = [
      ['blue-2', { tone: 'milestone', label: 'MILNÍK', title: 'PRVNÍ PENTAKILL V INFERNAL LEAGUE', imageUrl: LOGO }],
      ['red-0', { tone: 'milestone', label: 'MILNÍK', title: '100. KILL V INFERNAL LEAGUE', imageUrl: LOGO }],
      ['blue-4', { tone: 'record', label: 'NOVÝ REKORD LIGY', title: 'ASISTENCE · 23', imageUrl: LOGO }],
      ['red-3', { tone: 'milestone', label: 'MILNÍK', title: '25. HRA V INFERNAL LEAGUE', imageUrl: LOGO }],
    ]
    let i = 0
    const next = () => { const [key, banner] = samples[i++ % samples.length]; push(key, banner) }
    next()
    const demo = setInterval(next, 4_000)
    onUnmounted(() => clearInterval(demo))
  }
}
