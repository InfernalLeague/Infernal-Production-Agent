<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useIngameSelector } from '@/composables/useIngame'

// ── Upozornění na objektiv ve spodním panelu ────────────────────────────────
// Když tým získá draka, barona nebo věž, jeho polovina panelu hráčů krátce
// problikne barvou strany, rozsvítí se jeho část horní linky a nad panelem
// vyjede štítek s ikonou a názvem („OCEAN DRAKE", „BARON NASHOR", „TOWER").
//
// Události se poznají ze změny stavu, ze kterého kreslí scoreboard: přibyl
// drak v seznamu týmu, zvýšil se počet věží, zapnul se baron buff. První
// stav po načtení je jen výchozí bod, aby se po refreshi overlaye nespustila
// stará upozornění. Když počty klesnou (nová hra), výchozí bod se obnoví.
// Víc událostí naráz (věž a drak v jedné vteřině) jde za sebou.

const SHOW_MS = 3_200

type Side = 'blue' | 'red'

interface ObjectiveEvent {
  id: number
  side: Side
  icon: string
  name: string
}

interface TeamState {
  dragons: string[]
  towers: number
  baron: boolean
}

// Názvy draků jako ve hře (BlueBottle posílá nové i staré názvy živlů).
const DRAGONS: Record<string, { icon: string; name: string }> = {
  fire: { icon: 'fire', name: 'INFERNAL DRAKE' },
  infernal: { icon: 'fire', name: 'INFERNAL DRAKE' },
  water: { icon: 'water', name: 'OCEAN DRAKE' },
  ocean: { icon: 'water', name: 'OCEAN DRAKE' },
  air: { icon: 'air', name: 'CLOUD DRAKE' },
  cloud: { icon: 'air', name: 'CLOUD DRAKE' },
  wind: { icon: 'air', name: 'CLOUD DRAKE' },
  earth: { icon: 'earth', name: 'MOUNTAIN DRAKE' },
  mountain: { icon: 'earth', name: 'MOUNTAIN DRAKE' },
  hextech: { icon: 'hextech', name: 'HEXTECH DRAKE' },
  chemtech: { icon: 'chemtech', name: 'CHEMTECH DRAKE' },
}

const teams = useIngameSelector(
  (s) => ((s.gameData as any)?.scoreboard?.teams ?? null) as any[] | null,
  null,
)

function read(team: any): TeamState {
  return {
    dragons: Array.isArray(team?.dragons) ? team.dragons.map(String) : [],
    towers: Number(team?.towers ?? 0),
    baron: Boolean(team?.baronPowerPlay),
  }
}

function dragonEvent(side: Side, dragon: string): Omit<ObjectiveEvent, 'id'> {
  if (dragon.toLowerCase() === 'elder') return { side, icon: 'icons/elder.png', name: 'ELDER DRAGON' }
  const known = DRAGONS[dragon.toLowerCase()]
  return {
    side,
    icon: `icons/dragon-${known?.icon ?? dragon.toLowerCase()}-${side}.png`,
    name: known?.name ?? `${dragon.toUpperCase()} DRAKE`,
  }
}

let last: [TeamState, TeamState] | null = null
let nextId = 1
const queue: ObjectiveEvent[] = []
const current = ref<ObjectiveEvent | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

function showNext(): void {
  current.value = queue.shift() ?? null
  if (timer) clearTimeout(timer)
  timer = current.value ? setTimeout(showNext, SHOW_MS) : null
}

function push(event: Omit<ObjectiveEvent, 'id'>): void {
  queue.push({ ...event, id: nextId++ })
  if (!current.value) showNext()
}

watch(teams, (list) => {
  if (!list || list.length < 2) return
  const now: [TeamState, TeamState] = [read(list[0]), read(list[1])]
  const prev = last
  last = now
  if (!prev) return

  const reset = now.some((team, i) =>
    team.dragons.length < prev[i].dragons.length || team.towers < prev[i].towers)
  if (reset) return

  now.forEach((team, i) => {
    const side: Side = i === 0 ? 'blue' : 'red'
    for (const dragon of team.dragons.slice(prev[i].dragons.length)) push(dragonEvent(side, dragon))
    if (team.baron && !prev[i].baron) push({ side, icon: 'icons/baron.png', name: 'BARON NASHOR' })
    for (let n = prev[i].towers; n < team.towers; n++) {
      push({ side, icon: `icons/tower-${side}.png`, name: 'TOWER' })
    }
  })
}, { deep: true })

onUnmounted(() => { if (timer) clearTimeout(timer) })

// Ukázkový režim: ?mock&fx=objective spouští upozornění dokola, aby šlo
// zkontrolovat bez živé hry.
const params = new URLSearchParams(location.search)
if (params.has('mock') && params.get('fx') === 'objective') {
  const samples: Omit<ObjectiveEvent, 'id'>[] = [
    dragonEvent('red', 'Water'),
    { side: 'blue', icon: 'icons/baron.png', name: 'BARON NASHOR' },
    { side: 'blue', icon: 'icons/tower-blue.png', name: 'TOWER' },
  ]
  let i = 0
  const demo = setInterval(() => push(samples[i++ % samples.length]), 4_000)
  push(samples[i++])
  onUnmounted(() => clearInterval(demo))
}
</script>

<template>
  <template v-if="current">
    <div :key="'wash-' + current.id" class="ofx-wash" :class="'ofx-wash--' + current.side" />
    <div :key="'line-' + current.id" class="ofx-line" :class="'ofx-line--' + current.side" />
    <div :key="'chip-' + current.id" class="ofx-chip" :class="'ofx-chip--' + current.side">
      <img :src="current.icon" class="ofx-chip__icon" alt="" />
      <span class="ofx-chip__name">{{ current.name }}</span>
    </div>
  </template>
</template>

<style scoped>
/* Záblesk barvy strany přes polovinu panelu hráčů (pod obsahem panelu). */
.ofx-wash {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
  pointer-events: none;
  opacity: 0;
  animation: ofx-flash 1.4s ease-out forwards;
}
.ofx-wash--blue { left: 0;  background: linear-gradient(90deg,  rgba(251, 191, 36, 0.42), rgba(251, 191, 36, 0) 70%); }
.ofx-wash--red  { right: 0; background: linear-gradient(270deg, rgba(239, 68, 68, 0.42),  rgba(239, 68, 68, 0) 70%); }

/* Rozsvícená polovina horní linky. */
.ofx-line {
  position: absolute;
  top: -1px;
  width: 50%;
  height: 2px;
  pointer-events: none;
  opacity: 0;
  z-index: 3;
  animation: ofx-flash 1.6s ease-out forwards;
}
.ofx-line--blue { left: 0;  background: linear-gradient(90deg,  var(--il-blue-side), transparent); box-shadow: 0 0 10px var(--il-blue-side); }
.ofx-line--red  { right: 0; background: linear-gradient(270deg, var(--il-red-side),  transparent); box-shadow: 0 0 10px var(--il-red-side); }

/* Štítek nad panelem: ikona a název objektivu. */
.ofx-chip {
  position: absolute;
  bottom: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 16px 7px 10px;
  margin-bottom: 1px;
  background: var(--il-surface-edge);
  border: 1px solid var(--il-line);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  pointer-events: none;
  opacity: 0;
  animation: ofx-chip 3.2s var(--il-ease-out) forwards;
}
.ofx-chip--blue { left: 24px; }
.ofx-chip--red  { right: 24px; }

.ofx-chip__icon {
  width: 30px;
  height: 30px;
  object-fit: contain;
}
.ofx-chip__name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.08em;
}
.ofx-chip--blue .ofx-chip__name { color: var(--il-blue-side); }
.ofx-chip--red  .ofx-chip__name { color: var(--il-red-side); }

@keyframes ofx-flash {
  0%   { opacity: 0; }
  18%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes ofx-chip {
  0%   { opacity: 0; transform: translateY(14px); }
  12%  { opacity: 1; transform: none; }
  85%  { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(8px); }
}
</style>
