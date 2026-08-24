<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { getRemaining, isActive } from '@bluebottle_gg/league-broadcast-client'
import { useIngameSelector } from '@/composables/useIngame'

const CDN = 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/'

// BlueBottle serializes IngameObjectiveType as its numeric enum value
// (GRUB=0, HERALD=1, BARON=4, DRAGON_WATER=5, DRAGON_AIR=6, DRAGON_EARTH=7,
//  DRAGON_FIRE=8, DRAGON_HEXTECH=9, DRAGON_CHEMTECH=10, DRAGON_ELDER=11).
// The DevMock still uses string names to stay readable — normalize both here.
interface ObjCfg { icon: string; color: string }

const CFGS: Record<string, ObjCfg> = {
  'GRUB':            { icon: CDN + 'grub.png',           color: '#a78bfa' },
  'HERALD':          { icon: CDN + 'riftherald.png',      color: '#c084fc' },
  'BARON':           { icon: CDN + 'baron.png',           color: '#c084fc' },
  'DRAGON_WATER':    { icon: CDN + 'dragon_ocean.png',    color: '#22d3ee' },
  'DRAGON_AIR':      { icon: CDN + 'dragon_cloud.png',    color: '#bae6fd' },
  'DRAGON_EARTH':    { icon: CDN + 'dragon_mountain.png', color: '#a3e635' },
  'DRAGON_FIRE':     { icon: CDN + 'dragon_infernal.png', color: '#f97316' },
  'DRAGON_HEXTECH':  { icon: CDN + 'dragon_hextech.png',  color: '#22d3ee' },
  'DRAGON_CHEMTECH': { icon: CDN + 'dragon_chemtech.png', color: '#4ade80' },
  'DRAGON_ELDER':    { icon: CDN + 'dragon_elder.png',    color: '#fb923c' },
}

const TYPE_BY_ENUM: Record<number, string> = {
  0:  'GRUB',
  1:  'HERALD',
  4:  'BARON',
  5:  'DRAGON_WATER',
  6:  'DRAGON_AIR',
  7:  'DRAGON_EARTH',
  8:  'DRAGON_FIRE',
  9:  'DRAGON_HEXTECH',
  10: 'DRAGON_CHEMTECH',
  11: 'DRAGON_ELDER',
}

function normalizeType(raw: unknown): string {
  if (typeof raw === 'number') return TYPE_BY_ENUM[raw] ?? ''
  return String(raw ?? '')
}

function cfg(type: string): ObjCfg {
  return CFGS[type] ?? { icon: CDN + 'dragon.png', color: '#e2e8f0' }
}

// ── Automatic color extraction from icon images ────────────────────────────
// For each icon URL we draw it on a tiny canvas, sample all pixels and pick
// the most vibrant (high saturation, medium lightness) non-transparent pixel.
// Falls back to the hardcoded CFGS color while the image is loading.
const extractedColors = reactive<Record<string, string>>({})

function extractColor(url: string, fallback: string): void {
  if (extractedColors[url]) return
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    try {
      const SIZE = 24
      const canvas = document.createElement('canvas')
      canvas.width = SIZE; canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, SIZE, SIZE)
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE)

      let bestR = 255, bestG = 255, bestB = 255, bestScore = -1

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
        if (a < 128) continue           // skip transparent pixels

        const max = Math.max(r, g, b) / 255
        const min = Math.min(r, g, b) / 255
        const l   = (max + min) / 2
        const s   = max === min ? 0
          : l > 0.5 ? (max - min) / (2 - max - min)
                    : (max - min) / (max + min)

        if (l < 0.18 || l > 0.88) continue   // skip near-black / near-white
        const score = s * (1 - Math.abs(l - 0.6))
        if (score > bestScore) {
          bestScore = score; bestR = r; bestG = g; bestB = b
        }
      }
      extractedColors[url] = bestScore > 0
        ? `rgb(${bestR},${bestG},${bestB})`
        : fallback
    } catch {
      extractedColors[url] = fallback   // CORS or canvas error → use fallback
    }
  }
  img.onerror = () => { extractedColors[url] = fallback }
  img.src = url
}

function timerColor(type: string): string {
  const c = cfg(type)
  extractColor(c.icon, c.color)              // trigger extraction (no-op if done)
  return extractedColors[c.icon] ?? c.color  // fallback until image loads
}

// Data from BlueBottle:
// baronPitTimer / dragonPitTimer — iObjectiveRespawnData
//   type:        IngameObjectiveType (numeric enum: what was killed / will respawn)
//   timeDestroy: absolute game time the objective was last destroyed
//   timeAlive:   absolute game time of the next respawn
const gameTime    = useIngameSelector((s) => s.gameData?.gameTime ?? 0, 0)
const baronTimer  = useIngameSelector((s) => (s.gameData as any)?.baronPitTimer  ?? null, null)
const dragonTimer = useIngameSelector((s) => (s.gameData as any)?.dragonPitTimer ?? null, null)

// Diagnostics: log the raw pit payload each time the objective TYPE changes
// (undefined → element → next element, …). BlueBottle's shape before the first
// dragon is the interesting case — this shows exactly what it sends there, so we
// can tell a genuine BlueBottle data quirk apart from an overlay-side bug. Cheap:
// dragon type changes at most ~6× per game, baron once.
function logPit(label: string) {
  let last: unknown = Symbol('init')
  return (raw: any) => {
    if (raw?.type === last) return
    last = raw?.type
    try { console.info(`[ObjectiveTimers] ${label}:`, JSON.stringify(raw)) }
    catch { console.info(`[ObjectiveTimers] ${label} (non-JSON):`, raw) }
  }
}
watch(dragonTimer, logPit('dragonPitTimer'), { immediate: true })
watch(baronTimer,  logPit('baronPitTimer'),  { immediate: true })

interface Pit { key: string; type: string; alive: boolean; remaining: number }

function toPit(key: string, raw: any, gt: number): Pit | null {
  if (raw == null) return null

  const type = normalizeType(raw.type)
  if (!type) return null

  // BlueBottle timer contract (see league-broadcast-client index.d.ts):
  // `timeAlive` is an absolute-game-time "readyAt" and BlueBottle ships the
  // canonical interpreters. Using them (instead of hand-rolled `timeAlive - gt`)
  // means the alive/recovered/counting-down edge cases — including whatever
  // `timeAlive` BlueBottle reports before the first dragon — follow their spec,
  // not our guess. If the pre-first-dragon countdown still looks off, the
  // dragonPitTimer log above shows it's the source data, not our math.
  return {
    key,
    type,
    alive:     !isActive(raw.timeAlive, gt),
    remaining: getRemaining(raw.timeAlive, gt),
  }
}

const pits = computed((): Pit[] => {
  const gt  = gameTime.value
  const out: Pit[] = []

  const d = toPit('dragon', dragonTimer.value, gt)
  if (d) out.push(d)

  const b = toPit('baron', baronTimer.value, gt)
  if (b) out.push(b)

  return out
})

// Trigger color extraction whenever objective types change
watch(pits, (ps) => ps.forEach(p => extractColor(cfg(p.type).icon, cfg(p.type).color)),
  { immediate: true })

function fmt(remaining: number): string {
  const r = Math.max(0, Math.ceil(remaining))
  const m = Math.floor(r / 60)
  const s = r % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="obj-timers">
    <TransitionGroup name="obj">
      <div
        v-for="p in pits"
        :key="p.key"
        class="obj-timer"
        :class="{ 'obj-timer--alive': p.alive }"
      >
        <img :src="cfg(p.type).icon" class="obj-timer__icon" />
        <Transition name="time">
          <span
            v-if="!p.alive"
            class="obj-timer__time"
            :style="{ color: timerColor(p.type) }"
          >
            {{ fmt(p.remaining) }}
          </span>
        </Transition>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.obj-timers {
  position: absolute;
  left: 20px;
  top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.obj-timer {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(9, 5, 2, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 4px 12px 4px 6px;
  max-width: 150px;
  backdrop-filter: blur(6px);
  transition: padding 0.3s ease, max-width 0.3s ease;
  overflow: hidden;
}

/* Alive: shrink to just the icon */
.obj-timer--alive {
  padding: 4px;
  max-width: 36px;
}

.obj-timer__icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
}

.obj-timer__time {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.obj-enter-active { transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
.obj-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; position: absolute; }
.obj-enter-from   { opacity: 0; transform: translateX(-10px); }
.obj-leave-to     { opacity: 0; transform: translateX(-10px); }
.obj-move         { transition: transform 0.3s ease; }

.time-enter-active { transition: opacity 0.2s ease 0.15s; }
.time-leave-active { transition: opacity 0.15s ease; }
.time-enter-from,
.time-leave-to     { opacity: 0; }
</style>
