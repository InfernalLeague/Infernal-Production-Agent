import { onMounted, onUnmounted } from 'vue'
import type { BannerTone, PushBanner } from './useRowBanners'

// ── Zkušební pruhy z dashboardu ─────────────────────────────────────────────
// V agentovi (Overlaye pro OBS) jsou tlačítka s ukázkami milníků a rekordů
// z ligy. Pošlou pruh na /api/overlay/test a overlay — náhled i ten v OBS —
// si ho tady vyzvedne a pustí přes řádek hráče jako skutečný milník.
// První dotaz jen zjistí, kde fronta je, takže refresh nic nepřehraje.

const LOGO = 'icons/infernal-logo.png'
const POLL_MS = 1_000
const ROWS = ['blue-0', 'blue-1', 'blue-2', 'blue-3', 'blue-4', 'red-0', 'red-1', 'red-2', 'red-3', 'red-4']

interface TestBanner {
  seq: number
  row: string
  tone: BannerTone
  label: string
  title: string
}

export function useTestBanners(push: PushBanner): void {
  let after: number | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  async function poll(): Promise<void> {
    try {
      const response = await fetch(`/api/overlay/test${after === null ? '' : `?after=${after}`}`, { cache: 'no-store' })
      if (!response.ok) return
      const data = (await response.json()) as { seq: number; banners: TestBanner[] }
      if (after !== null) {
        for (const banner of data.banners) {
          const row = ROWS.includes(banner.row) ? banner.row : ROWS[Math.floor(Math.random() * ROWS.length)]
          push(row, { tone: banner.tone, label: banner.label, title: banner.title, imageUrl: LOGO })
        }
      }
      after = data.seq
    } catch {
      // Overlay mimo agenta (Vite dev server) zkušební pruhy nemá — nevadí.
    }
  }

  onMounted(() => {
    void poll()
    timer = setInterval(poll, POLL_MS)
  })
  onUnmounted(() => {
    if (timer !== null) clearInterval(timer)
  })
}
