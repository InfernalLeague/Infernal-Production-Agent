import { ref, onMounted, onUnmounted } from 'vue'
import { useClient } from '@/client'

// ── Fearless draft bans (REST) ──────────────────────────────────────────────
// In a fearless series the champions picked in PREVIOUS games are locked out of
// later games. BlueBottle does NOT put these on the champ-select team object
// (team.fearlessBans is empty over the WebSocket) — they come from the REST API:
//   GET match/current/fearless/bans
// which returns:  { [gameId]: { [teamId]: simpleChampionData[] } }
//   - outer key = game id (ascending = game order: 1st, 2nd, …)
//   - inner key = team id (matched to blue/red side via metaData.teamId)
//   - value     = champions used by that team in that game
// The current game's arrays are empty (no picks yet).
export interface FearlessChamp {
  name?: string
  alias?: string
  squareImg?: string
}
export type FearlessBansMap = Record<number, Record<number, FearlessChamp[]>>

export function useFearlessBans(refreshMs = 5_000) {
  const client = useClient()
  const bans = ref<FearlessBansMap>({})

  async function fetchOnce(): Promise<void> {
    try {
      const res = await (client as any).api?.match?.getBans?.()
      if (res && typeof res === 'object') bans.value = res as FearlessBansMap
    } catch {
      // Keep the previous data on a transient error.
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    fetchOnce()
    timer = setInterval(fetchOnce, refreshMs)
  })

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  return { bans }
}
