import { onUnmounted, watch, type Ref } from 'vue'
import type { PushBanner } from './useRowBanners'

// ── Dokončený item ──────────────────────────────────────────────────────────
// Když hráči v inventáři přibyde dokončený item, přes jeho řádek ve spodním
// panelu vyjede pruh „DOKONČIL · NAVORI FLICKERBLADE" s ikonou itemu.
//
// Dokončený item = item za 2000 goldů a víc. Suroviny, boty a lektvary jsou
// levnější, takže se tím odfiltrují bez seznamu ID, který by po každém patchi
// zastaral. První stav hráče (i po změně championa = nová hra) je jen výchozí
// bod, aby se po refreshi overlaye nespustily staré nákupy.

const MIN_COST = 2000

interface PanelItem {
  id: number
  name?: string
  imageUrl?: string
  cost?: number
}

interface PanelPlayer {
  champion?: { alias?: string } | null
  items?: (PanelItem | null)[]
}

export function useItemCompletions(blue: Ref<PanelPlayer[]>, red: Ref<PanelPlayer[]>, push: PushBanner): void {
  const seen = new Map<string, { alias: string; ids: Set<number> }>()

  function scan(side: 'blue' | 'red', players: PanelPlayer[]): void {
    players.forEach((player, index) => {
      const key = `${side}-${index}`
      const alias = player.champion?.alias ?? ''
      const items = (player.items ?? []).filter((item): item is PanelItem => Boolean(item?.id))
      const prev = seen.get(key)
      seen.set(key, { alias, ids: new Set(items.map((item) => item.id)) })
      if (!prev || prev.alias !== alias) return

      for (const item of items) {
        if (prev.ids.has(item.id) || (item.cost ?? 0) < MIN_COST) continue
        push(key, { tone: 'item', label: 'DOKONČIL', title: (item.name ?? '').toUpperCase(), imageUrl: item.imageUrl ?? '' })
      }
    })
  }

  watch([blue, red], ([bluePlayers, redPlayers]) => {
    scan('blue', bluePlayers)
    scan('red', redPlayers)
  })

  // Ukázkový režim: ?mock&fx=item střídá nákupy u dvou hráčů.
  const params = new URLSearchParams(location.search)
  if (params.has('mock') && params.get('fx') === 'item') {
    const samples: [string, string, string][] = [
      ['red-1', 'NAVORI FLICKERBLADE', 'https://ddragon.leagueoflegends.com/cdn/14.24.1/img/item/6675.png'],
      ['blue-3', 'INFINITY EDGE', 'https://ddragon.leagueoflegends.com/cdn/14.24.1/img/item/3031.png'],
    ]
    let i = 0
    const next = () => {
      const [key, title, imageUrl] = samples[i++ % samples.length]
      push(key, { tone: 'item', label: 'DOKONČIL', title, imageUrl })
    }
    next()
    const demo = setInterval(next, 4_000)
    onUnmounted(() => clearInterval(demo))
  }
}
