import { onUnmounted, reactive } from 'vue'

// ── Pruhy přes řádek hráče ve spodním panelu ────────────────────────────────
// Dokončený item i milník z ligy se ukazují stejně: pruh přes celý řádek
// hráče s ikonou, malým štítkem a hlavním textem. Sdílejí jednu frontu na
// řádek, aby se nepřekryly — co přijde naráz, jde za sebou.

const SHOW_MS = 3_400

export type BannerTone = 'item' | 'milestone' | 'record'

export interface RowBanner {
  seq: number
  tone: BannerTone
  /** Malý štítek nad hlavním textem („DOKONČIL", „MILNÍK"…). */
  label: string
  title: string
  imageUrl: string
}

export type PushBanner = (key: string, banner: Omit<RowBanner, 'seq'>) => void

/** Klíč řádku je strana a pořadí v týmu: `blue-0` … `red-4`. */
export function useRowBanners(): { active: Record<string, RowBanner | undefined>; push: PushBanner } {
  const active = reactive<Record<string, RowBanner | undefined>>({})
  const queues = new Map<string, RowBanner[]>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let seq = 1

  function showNext(key: string): void {
    const next = queues.get(key)?.shift()
    active[key] = next
    const old = timers.get(key)
    if (old) clearTimeout(old)
    if (next) timers.set(key, setTimeout(() => showNext(key), SHOW_MS))
    else timers.delete(key)
  }

  const push: PushBanner = (key, banner) => {
    const queue = queues.get(key) ?? []
    queue.push({ ...banner, seq: seq++ })
    queues.set(key, queue)
    if (!active[key]) showNext(key)
  }

  onUnmounted(() => {
    for (const timer of timers.values()) clearTimeout(timer)
  })

  return { active, push }
}
