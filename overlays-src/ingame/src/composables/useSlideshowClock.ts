import { ref, onMounted, onUnmounted } from 'vue'

// ── Shared slideshow clock ──────────────────────────────────────────────────
// The overlay has two rotating slideshows that must advance in lockstep:
//   · LFrame  — sponsor banners (bottom-left L frame)
//   · PatchPanel — SEASON / SPLIT / ČTVRTFINÁLE labels next to the minimap
//
// Previously each ran its own setInterval at a different cadence, so they drifted
// apart within seconds. Instead of two timers, a SINGLE module-level interval
// increments `tick`; every consumer derives its own slide index as
// `tick % slides.length`. Because they all read the same counter, they change on
// the exact same beat no matter how many slides each one has.
//
// The LFrame banner rotation is the master cadence — this is the period both
// slideshows follow.
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
