import { ref, onMounted, onUnmounted } from 'vue'
import { useClient } from '@/client'
import type { GameState } from '@bluebottle_gg/league-broadcast-client'

// GameStateSnapshot shape: { gameData, gameState, version }
export function useIngameSelector<T>(
  selector: (snapshot: { gameData: any; gameState: GameState; version: number }) => T,
  defaultValue: T,
) {
  const client = useClient()
  const value = ref<T>(defaultValue) as { value: T }

  // ingameStore.watchImmediate fires the callback immediately with the current
  // snapshot, then again on every subsequent change — unlike watchIngame (which
  // wraps ingameStore.watch and only fires on changes after subscription).
  // This ensures data is available on first render even if the game was already
  // running when the overlay connected.
  const unsub = client.ingameStore.watchImmediate(selector as any, (next: T) => {
    value.value = next
  })

  onUnmounted(() => unsub())

  return value
}

export function useIngameConnected() {
  const client = useClient()
  const connected = ref(client.isIngameConnected())

  const unsubConnect    = client.onIngameConnect(() => { connected.value = true })
  const unsubDisconnect = client.onIngameDisconnect(() => { connected.value = false })

  onUnmounted(() => {
    unsubConnect()
    unsubDisconnect()
  })

  return connected
}

export function useIsInGame() {
  const client = useClient()
  const inGame = ref(false)

  const unsub = client.ingameStore.watchImmediate(
    (s) => {
      const gs = s.gameState as unknown as string | number
      // BlueBottle may send gameState as a string ('Running') or numeric enum (2 = Running, 3 = Paused)
      return gs === 'Running' || gs === 'Paused' || gs === 'Mocking'
          || gs === 2 || gs === 3
    },
    (val: boolean) => { inGame.value = val },
  )

  onUnmounted(() => unsub())

  return inGame
}

// ── Tab-player data via REST poll ──────────────────────────────────────────
// BlueBottle only includes `gameData.tabs` in WebSocket updates when its own
// overlay has an active "tab" view — it is never populated during normal
// gameplay for custom overlays. The REST endpoint always returns current data.
// We poll every 1 s so health/resource/XP/abilities/perks stay fresh.
export function useTabPlayers() {
  const client = useClient()
  // Record<teamId, tabPlayer[]>  — keys are 100 (blue) and 200 (red)
  const tabPlayers = ref<Record<number, any[]>>({})

  let _loggedFirstSuccess = false

  async function fetchOnce() {
    try {
      const result = await client.api.gameState.getAllTeamParticipants()
      if (result && typeof result === 'object') {
        if (!_loggedFirstSuccess) {
          console.info('[overlay] getAllTeamParticipants OK — keys:', Object.keys(result))
          // Log player names + champion aliases so we can verify matching
          for (const [teamId, players] of Object.entries(result)) {
            const summary = (players as any[]).map((p: any) =>
              `${p.playerName}/${p.championAssets?.alias ?? '?'}`,
            )
            console.info(`[overlay] team ${teamId} players:`, summary)
          }
          _loggedFirstSuccess = true
        }
        tabPlayers.value = result
      }
    } catch (err) {
      // Not in game or API unreachable — keep previous value so display
      // doesn't flicker if there's a brief network hiccup.
      console.warn('[overlay] getAllTeamParticipants failed:', err)
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null

  onMounted(() => {
    fetchOnce()                           // immediate on mount
    timer = setInterval(fetchOnce, 1000)  // then every 1 s
  })

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })

  return tabPlayers
}
