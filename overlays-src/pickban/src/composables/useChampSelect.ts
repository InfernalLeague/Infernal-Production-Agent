import { ref, onUnmounted } from 'vue'
import { useClient } from '@/client'
import type { ChampSelectSnapshot } from '@bluebottle_gg/league-broadcast-client'

export function useChampSelectSelector<T>(
  selector: (snapshot: ChampSelectSnapshot) => T,
  defaultValue: T,
) {
  const client = useClient()
  const value = ref<T>(defaultValue) as { value: T }

  const unsub = client.preGameStore.watchImmediate(selector as any, (next: T) => {
    value.value = next
  })

  onUnmounted(() => unsub())

  return value
}

export function useIsChampSelectActive() {
  return useChampSelectSelector((s) => s.isActive, false)
}

export function usePreGameConnected() {
  const client = useClient()
  const connected = ref(client.isPreGameConnected())

  const unsubConnect    = client.onPreGameConnect(() => { connected.value = true })
  const unsubDisconnect = client.onPreGameDisconnect(() => { connected.value = false })

  onUnmounted(() => {
    unsubConnect()
    unsubDisconnect()
  })

  return connected
}
