<script setup lang="ts">
import { computed, watch } from 'vue'
import { useIsInGame, useIngameSelector } from '@/composables/useIngame'
import { useSlideshowClock } from '@/composables/useSlideshowClock'

const isInGame = useIsInGame()

// ── Slideshow (default view) ─────────────────────────────────────────────────
// When no inhibitor is down, the side panel cycles through these labels instead
// of a static patch number. Rotace jede na SDÍLENÝCH hodinách (useSlideshowClock),
// stejných jako bannery v LFramu — texty i bannery se tak přepínají naráz ve
// stejný okamžik a nikdy se nerozjedou. LFrame je master kadence.
const SLIDES = ['SEASON 2026', 'SPLIT 0', 'ČTVRTFINÁLE']
const tick = useSlideshowClock()
const currentSlide = computed(() => SLIDES[tick.value % SLIDES.length])

// ── Inhibitor timers ───────────────────────────────────────────────────────
const gameTime      = useIngameSelector((s) => s.gameData?.gameTime ?? 0, 0)
const inhibitorData = useIngameSelector((s) => (s.gameData as any)?.inhibitors ?? null, null)

// Log the raw BlueBottle payload once, the first time it arrives — it shows the
// actual shape off the stream (notably team/teamid/side, which resolveTeam relies
// on). Only the first payload is logged; the shape never changes mid-game and
// stringifying every update would be pure noise in OBS.
let _loggedPayload = false
watch(inhibitorData, (v) => {
  if (_loggedPayload || v == null) return
  _loggedPayload = true
  try {
    console.info('[PatchPanel] inhibitors payload:', JSON.stringify(v))
  } catch { console.info('[PatchPanel] inhibitors payload (non-JSON):', v) }
}, { immediate: true })

// IngameObjectiveType: INHIBITOR_L0=12 (bot), L1=13 (mid), L2=14 (top)
// Confirmed empirically off the live stream: L0 is the BOT-lane inhibitor and
// L2 is the TOP-lane one (opposite of the enum's numeric intuition).
// BlueBottle may serialize the enum as a number OR as the string name — handle both.
const LANE: Record<string | number, string> = {
  12: 'BOT', 13: 'MID', 14: 'TOP',
  'INHIBITOR_L0': 'BOT', 'INHIBITOR_L1': 'MID', 'INHIBITOR_L2': 'TOP',
}

// teamInhibitorData carries team/teamid/side — never trust the array order,
// BlueBottle does not guarantee [blue, red]. Prefer the explicit fields and
// only fall back to the index if none of them are usable.
//
// NOTE: this resolves the team that DESTROYED the inhibitor. The respawn timer
// belongs to the team whose inhibitor was destroyed (the owner), i.e. the
// OPPOSITE side — see activeInhibs, where we flip it before display.
function resolveTeam(teamData: any, idx: number): 0 | 1 {
  const teamid = teamData?.teamid
  if (teamid === 100) return 0
  if (teamid === 200) return 1

  const team = typeof teamData?.team === 'string' ? teamData.team : ''
  if (/order|blue/i.test(team))  return 0
  if (/chaos|red/i.test(team))   return 1

  const side = teamData?.side
  if (side === 0) return 0
  if (side === 1) return 1

  console.warn('[PatchPanel] cannot resolve inhibitor team, using array index:', teamData)
  return (idx === 0 ? 0 : 1) as 0 | 1
}

interface InhibRow {
  key:         string
  team:        0 | 1   // 0 = blue, 1 = red
  lane:        string
  timeAlive:   number  // absolute game time of respawn
  timeDestroy: number  // absolute game time when destroyed
}

const activeInhibs = computed((): InhibRow[] => {
  const data = inhibitorData.value
  const gt   = gameTime.value
  if (!data || !Array.isArray(data)) return []
  const rows: InhibRow[] = []
  data.forEach((teamData: any, idx: number) => {
    const inhibs = teamData?.inhibitors
    if (!inhibs || typeof inhibs !== 'object') return
    // The payload groups a destroyed inhibitor under the team that destroyed it,
    // but the respawn countdown belongs to the owner — the OPPOSITE side. So if
    // red destroys an inhibitor, the timer must show on blue side, and vice versa.
    const team = (resolveTeam(teamData, idx) === 0 ? 1 : 0) as 0 | 1
    for (const [key, inhib] of Object.entries(inhibs as Record<string, any>)) {
      const i = inhib as any
      if (i.timeAlive == null || i.timeAlive <= gt) continue
      rows.push({
        key:         `${idx}-${key}`,
        team,
        lane:        LANE[i.type as number] ?? '?',
        timeAlive:   i.timeAlive,
        timeDestroy: i.timeDestroy ?? 0,
      })
    }
  })
  return rows
})

// Bars are ordered by respawn time so the soonest-spawning inhibitor sits
// closest to that side's timer (the outer edge of the panel):
//  · Red timer is at the TOP, so red bars run soonest → latest going downward.
//  · Blue timer is at the BOTTOM, so blue bars run latest → soonest going
//    downward (soonest ends up bottom-most, nearest the timer).
const redBars  = computed(() =>
  activeInhibs.value.filter(i => i.team === 1).sort((a, b) => a.timeAlive - b.timeAlive),
)
const blueBars = computed(() =>
  activeInhibs.value.filter(i => i.team === 0).sort((a, b) => b.timeAlive - a.timeAlive),
)

// Timer shows the soonest inhibitor per team
const redSoonest  = computed(() =>
  activeInhibs.value.filter(i => i.team === 1).reduce<InhibRow | null>((best, i) => !best || i.timeAlive < best.timeAlive ? i : best, null),
)
const blueSoonest = computed(() =>
  activeInhibs.value.filter(i => i.team === 0).reduce<InhibRow | null>((best, i) => !best || i.timeAlive < best.timeAlive ? i : best, null),
)

function fmt(timeAlive: number, gt: number): string {
  const r = Math.max(0, Math.ceil(timeAlive - gt))
  return `${Math.floor(r / 60)}:${(r % 60).toString().padStart(2, '0')}`
}

// Drain 1→0: how much time remains on the respawn timer (1 = just destroyed, 0 = about to spawn)
function inhibFill(inhib: InhibRow, gt: number): number {
  const total   = inhib.timeAlive - inhib.timeDestroy
  const elapsed = gt - inhib.timeDestroy
  return total > 0 ? Math.max(0, Math.min(1, 1 - elapsed / total)) : 0
}
</script>

<template>
  <Transition name="pp">
    <div v-if="isInGame" class="ppanel">
      <Transition name="swap" mode="out-in">

        <!-- ── Inhibitor view ───────────────────────────────────────── -->
        <div v-if="activeInhibs.length" key="inhibs" class="ppanel__inhibview">

          <!-- Red side: timer at top, bars below toward center -->
          <div v-if="redBars.length" class="ppanel__side">
            <div class="ppanel__timer ppanel__timer--r">
              <span class="ppanel__timer-val ppanel__timer-val--r">
                {{ redSoonest ? fmt(redSoonest.timeAlive, gameTime) : '' }}
              </span>
            </div>
            <div class="ppanel__bars">
              <div
                v-for="inhib in redBars"
                :key="inhib.key"
                class="ppanel__bar ppanel__bar--r"
              >
                <div
                  class="ppanel__bar-fill ppanel__bar-fill--r"
                  :style="{ width: inhibFill(inhib, gameTime) * 100 + '%' }"
                />
                <span class="ppanel__bar-lane">{{ inhib.lane }}</span>
                <img
                  class="ppanel__bar-inhib"
                  src="https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/inhibitor.png"
                  alt=""
                />
              </div>
            </div>
          </div>

          <!-- Center gap -->
          <div class="ppanel__gap" />

          <!-- Blue side: bars from center downward, timer at bottom -->
          <div v-if="blueBars.length" class="ppanel__side">
            <div class="ppanel__bars">
              <div
                v-for="inhib in blueBars"
                :key="inhib.key"
                class="ppanel__bar ppanel__bar--y"
              >
                <div
                  class="ppanel__bar-fill ppanel__bar-fill--y"
                  :style="{ width: inhibFill(inhib, gameTime) * 100 + '%' }"
                />
                <span class="ppanel__bar-lane">{{ inhib.lane }}</span>
                <img
                  class="ppanel__bar-inhib"
                  src="https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/inhibitor.png"
                  alt=""
                />
              </div>
            </div>
            <div class="ppanel__timer ppanel__timer--y">
              <span class="ppanel__timer-val ppanel__timer-val--y">
                {{ blueSoonest ? fmt(blueSoonest.timeAlive, gameTime) : '' }}
              </span>
            </div>
          </div>

        </div>

        <!-- ── Slideshow view (default) ─────────────────────────────── -->
        <div v-else key="slides" class="ppanel__patch">
          <Transition name="slide" mode="out-in">
            <span :key="currentSlide" class="ppanel__text">{{ currentSlide }}</span>
          </Transition>
        </div>

      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.ppanel {
  position: absolute;
  right: 221px;
  bottom: 0;
  width: 84px;
  height: 221px;
  background: #090502;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 10;
  overflow: hidden;
}

/* ── Patch (default) ─────────────────────────────────────────── */
.ppanel__patch {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ppanel__text {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 30px;
  letter-spacing: 0.12em;
  color: rgba(249, 115, 22, 0.90); /* stejná oranžová jako „INFERNAL LEAGUE" v LFrame */
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  white-space: nowrap;
}

/* ── Inhibitor view ──────────────────────────────────────────── */
/* The panel is split into 8 equal slots (--slot high). The top and bottom
   slots hold each side's timer; the middle 6 are available for inhibitor
   countdown bars (max 3 per side). Sides are pinned to the top/bottom edges
   with space-between, so any unused slots collapse into the center gap. */
.ppanel__inhibview {
  --slot: 26px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 0 4px;
}

/* Worst case = all 6 inhibitors down: 8 slots × 26px + 6 × 1px gaps = 214px,
   which fits inside the 221px panel with a small center gap to spare. */
.ppanel__side {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* Center spacer — absorbs slots left empty by missing bars */
.ppanel__gap { flex: 1; min-height: 4px; }

/* ── Timer ───────────────────────────────────────────────────── */
.ppanel__timer {
  height: var(--slot);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ppanel__timer-val {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.04em;
}

.ppanel__timer-val--r { color: rgba(239, 68, 68,  0.95); }
.ppanel__timer-val--y { color: rgba(251, 188, 35, 0.95); }

/* ── Bars ────────────────────────────────────────────────────── */
.ppanel__bars {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ppanel__bar {
  position: relative;
  height: var(--slot);
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 0 7px;
}

.ppanel__bar--r {
  background: rgba(239, 68, 68, 0.08);
  border-left: 2px solid rgba(239, 68, 68, 0.65);
}
.ppanel__bar--y {
  background: rgba(251, 188, 35, 0.08);
  border-left: 2px solid rgba(251, 188, 35, 0.65);
}

/* Fill sweeps from left — shows how far through respawn we are */
.ppanel__bar-fill {
  position: absolute;
  top: 0; left: 0;
  height: 100%;
  transition: width 0.5s ease;
}
.ppanel__bar-fill--r { background: rgba(239, 68, 68, 0.30); }
.ppanel__bar-fill--y { background: rgba(251, 188, 35, 0.30); }

.ppanel__bar-lane {
  position: relative;
  z-index: 1;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.10em;
  color: rgba(255, 255, 255, 0.92);
  line-height: 1;
}

/* Inhibitor icon — sits right after the lane label */
.ppanel__bar-inhib {
  position: relative;
  z-index: 1;
  width: 17px;
  height: 17px;
  margin-left: 5px;
  object-fit: contain;
  flex-shrink: 0;
  filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.75));
}

/* ── Transitions ─────────────────────────────────────────────── */
.pp-enter-active   { transition: opacity 0.5s ease; }
.pp-leave-active   { transition: opacity 0.3s ease; }
.pp-enter-from,
.pp-leave-to       { opacity: 0; }

.swap-enter-active { transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
.swap-leave-active { transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.55, 0, 1, 0.45); }
.swap-enter-from,
.swap-leave-to     { opacity: 0; transform: translateX(84px); }

/* Slideshow crossfade between labels (opacity only — the label keeps its
   rotate(180deg) base transform, so we must not animate transform here) */
.slide-enter-active { transition: opacity 0.55s ease; }
.slide-leave-active { transition: opacity 0.45s ease; }
.slide-enter-from,
.slide-leave-to     { opacity: 0; }
</style>
