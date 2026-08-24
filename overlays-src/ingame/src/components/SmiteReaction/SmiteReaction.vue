<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useClient } from '@/client'
import { useIngameSelector } from '@/composables/useIngame'

// Event-based popup shown when jungler smites a major objective (Baron / Dragon).
// BB populates smiteReaction in both gameData.objectiveDps and gameData.damageRecap;
// we use whichever fires first for a given smiteLandedTime and dedupe.
//
// Data we surface:
//  – jungler name + champion portrait
//  – reactionTimeSeconds (star metric — from smite-range entry to smite landing)
//  – smite damage
//  – SECURED (killing blow) vs STOLEN (enemy jungler stole it)
//  – objective name (Baron Nashor / dragon element / Rift Herald / …)
//
// Popup auto-hides after DISPLAY_MS; each new event resets the timer.

const DISPLAY_MS = 6_000

const client   = useClient()
const resolveUrl = (path?: string | null): string => (path ? client.getCacheUrl(path) : '')

const objDps      = useIngameSelector((s) => (s.gameData as any)?.objectiveDps ?? null, null)
const damageRecap = useIngameSelector((s) => (s.gameData as any)?.damageRecap ?? null, null)

interface ActiveReaction {
  jungler: string
  championImg: string
  reactionTime: number
  smiteDamage: number
  wasKillingBlow: boolean
  team: number  // 1 = blue / Order, 2 = red / Chaos
  objectiveName: string
}

const active = ref<ActiveReaction | null>(null)
let hideTimer: ReturnType<typeof setTimeout> | null = null
let lastLandedTime = 0

// BB sometimes sends an objective name we can't use — an empty string or a
// wrapper object, which Vue would otherwise render raw into the popup.
// Coerce to a plain string; anything unusable falls back to a generic label.
function cleanName(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  // Wrapper shapes such as { value: 'Baron Nashor' } — take the inner string.
  if (raw && typeof raw === 'object' && typeof (raw as any).value === 'string') {
    return (raw as any).value.trim()
  }
  return ''
}

function trigger(sr: any, objectiveNameRaw: unknown): void {
  if (!sr) return

  const objectiveName = cleanName(objectiveNameRaw)
  if (!objectiveName) {
    console.info('[smite-reaction] no usable objective name in payload:',
      { rawObjectiveName: objectiveNameRaw })
  }
  const landed = sr.smiteLandedTime ?? 0
  // Dedupe: same event surfaces in multiple streams — only fire once per landing.
  if (landed <= 0 || landed === lastLandedTime) return
  lastLandedTime = landed

  active.value = {
    jungler:        sr.junglerDisplayName || sr.junglerName || 'Jungler',
    championImg:    resolveUrl(sr.junglerChampion?.squareImg),
    reactionTime:   sr.reactionTimeSeconds ?? 0,
    smiteDamage:    Math.round(sr.smiteDamage ?? 0),
    wasKillingBlow: Boolean(sr.wasKillingBlow),
    team:           sr.junglerTeam ?? 1,
    objectiveName:  objectiveName || 'Objective',
  }

  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { active.value = null }, DISPLAY_MS)
}

// objectiveDps carries the objective name alongside smiteReaction — richest source
watch(objDps, (d) => trigger(d?.smiteReaction, d?.objectiveName ?? ''), { deep: true })
// damageRecap smiteReaction is a fallback; objective name isn't available there,
// so we label it from the dragonType if present, otherwise a generic label.
watch(damageRecap, (d) => {
  // Empty name → trigger() falls back to the generic label.
  const dragon = d?.dragonType ? `${d.dragonType} Dragon` : ''
  trigger(d?.smiteReaction, dragon)
}, { deep: true })

onUnmounted(() => { if (hideTimer) clearTimeout(hideTimer) })

// Pretty formatter — reaction time is fractional seconds
function fmtReaction(s: number): string {
  return s < 1 ? s.toFixed(2) + 's' : s.toFixed(1) + 's'
}
</script>

<template>
  <Transition name="sr">
    <div
      v-if="active"
      class="sr"
      :class="{
        'sr--blue':    active.team === 1,
        'sr--red':     active.team === 2,
        'sr--secured': active.wasKillingBlow,
        'sr--stolen':  !active.wasKillingBlow,
      }"
    >
      <!-- Verdict badge — SECURED (killing blow) or STOLEN (enemy took it) -->
      <div class="sr__verdict">
        {{ active.wasKillingBlow ? 'SECURED' : 'STOLEN' }}
      </div>

      <div class="sr__body">
        <img
          v-if="active.championImg"
          :src="active.championImg"
          :alt="active.jungler"
          class="sr__champ"
        />
        <div v-else class="sr__champ sr__champ--ph" />

        <div class="sr__info">
          <div class="sr__top">
            <span class="sr__name">{{ active.jungler }}</span>
            <span class="sr__obj">{{ active.objectiveName }}</span>
          </div>
          <div class="sr__stats">
            <div class="sr__stat">
              <span class="sr__label">REACTION</span>
              <span class="sr__value sr__value--reaction">{{ fmtReaction(active.reactionTime) }}</span>
            </div>
            <div class="sr__vsep" />
            <div class="sr__stat">
              <span class="sr__label">SMITE</span>
              <span class="sr__value">{{ active.smiteDamage }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── Popup wrapper — centered, below scoreboard ────────────────────── */
.sr {
  position: absolute;
  top: 160px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  min-width: 380px;
  max-width: 520px;
  background: rgba(9, 5, 2, 0.94);
  border: 1px solid rgba(249, 115, 22, 0.28);
  border-radius: 4px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.75),
              inset 0 1px 0 rgba(249, 115, 22, 0.08);
  overflow: hidden;
  pointer-events: none;
}

/* Team-side accent — thick colored bar on the appropriate side */
.sr--blue { border-left: 4px solid rgba(251, 191, 36, 0.85); }
.sr--red  { border-right: 4px solid rgba(239, 68, 68, 0.85); }

/* Verdict tint — subtle glow behind the header */
.sr--secured {
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.75),
              0 0 24px rgba(74, 222, 128, 0.25),
              inset 0 1px 0 rgba(74, 222, 128, 0.20);
}
.sr--stolen {
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.75),
              0 0 24px rgba(239, 68, 68, 0.35),
              inset 0 1px 0 rgba(239, 68, 68, 0.25);
}

/* ── Verdict badge (SECURED / STOLEN) ──────────────────────────────── */
.sr__verdict {
  padding: 5px 14px 4px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  text-align: center;
  line-height: 1;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.sr--secured .sr__verdict {
  color: #86efac;
  background: linear-gradient(90deg, rgba(22, 163, 74, 0.35), rgba(22, 163, 74, 0.15));
  text-shadow: 0 0 10px rgba(74, 222, 128, 0.55);
}
.sr--stolen .sr__verdict {
  color: #fca5a5;
  background: linear-gradient(90deg, rgba(220, 38, 38, 0.35), rgba(220, 38, 38, 0.15));
  text-shadow: 0 0 10px rgba(239, 68, 68, 0.55);
}

/* ── Body row: champion + info ─────────────────────────────────────── */
.sr__body {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
}

.sr__champ {
  width: 56px;
  height: 56px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.7));
}
.sr__champ--ph {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.sr--blue .sr__champ { border: 2px solid rgba(251, 191, 36, 0.55); }
.sr--red  .sr__champ { border: 2px solid rgba(239, 68, 68, 0.55); }

.sr__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Top line: jungler name + objective */
.sr__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.sr__name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.98);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr--blue .sr__name { color: #fbbf24; }
.sr--red  .sr__name { color: #ef4444; }

.sr__obj {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
}

/* Stats row: reaction time (star) + smite damage */
.sr__stats {
  display: flex;
  align-items: center;
  gap: 14px;
}
.sr__stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.sr__label {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.sr__value {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.98);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}
/* Reaction time is the headline metric — larger + orange accent */
.sr__value--reaction {
  font-size: 26px;
  color: #fb923c;
  text-shadow: 0 0 12px rgba(249, 115, 22, 0.55),
               0 1px 4px rgba(0, 0, 0, 0.9);
}
.sr__vsep {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.12);
}

/* ── Transitions ───────────────────────────────────────────────────── */
.sr-enter-active { transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease; }
.sr-leave-active { transition: transform 0.4s ease, opacity 0.3s ease; }
.sr-enter-from   { transform: translate(-50%, -20px); opacity: 0; }
.sr-leave-to     { transform: translate(-50%, -12px); opacity: 0; }
</style>
