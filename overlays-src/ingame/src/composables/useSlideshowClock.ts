import { ref, onMounted, onUnmounted } from 'vue'

// ── Shared slideshow clock ──────────────────────────────────────────────────
// A SINGLE module-level interval increments `tick`; every rotating slideshow
// (today the LFrame sponsor banners) derives its slide index as
// `tick % slides.length`, so any slideshows added later change on the same beat.
// (PatchPanel next to the minimap used to rotate too; it now shows a fixed label.)
export const SLIDE_CYCLE_MS = 10_000

const tick = ref(0)
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Subscribe to the shared slideshow beat. Returns a reactive `tick` counter that
 * increments every SLIDE_CYCLE_MS. The underlying interval is ref-counted: it
 * starts on the first subscriber and stops once the last one unmounts.
 */
export function useSlideshowClock() {
  onMounted(() => {
    if (subscribers === 0) {
      timer = setInterval(() => { tick.value++ }, SLIDE_CYCLE_MS)
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

  return tick
}
