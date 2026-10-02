<script setup lang="ts">
import { computed } from 'vue'
import { useIsInGame } from '@/composables/useIngame'
import { useMatchContext, type OverlayBriefTeam } from '@/composables/useMatchContext'
import { useSlideshowClock } from '@/composables/useSlideshowClock'

const isInGame = useIsInGame()
const match = useMatchContext()

// ── L-Frame vlevo dole ──────────────────────────────────────────────────────
// Jedna plocha 305 × 220 px, která střídá:
//   1. logo ligy a pod ním INFERNAL LEAGUE (vždy),
//   2. další zápas večera (když je),
//   3. obrázky z Admin → Media / Assets → In-game overlay (když jsou).
// Obrázky i další zápas posílá web přes agenta (useMatchContext), takže výměna
// sponzora nepotřebuje nové vydání agenta. Obrázek vyplní celou plochu,
// v adminu se proto doporučuje 610 × 440 px.
//
// Rotace jede na sdílených hodinách (useSlideshowClock), stejně jako panel
// vedle minimapy, takže se obě místa přepínají ve stejný okamžik.

type Slide =
  | { kind: 'brand'; key: string }
  | { kind: 'next'; key: string; time: string | null; a: OverlayBriefTeam; b: OverlayBriefTeam }
  | { kind: 'image'; key: string; url: string }

const slides = computed<Slide[]>(() => {
  const list: Slide[] = [{ kind: 'brand', key: 'brand' }]
  const next = match.value?.nextMatch
  if (next) {
    list.push({ kind: 'next', key: 'next', time: pragueTime(next.scheduledAt), a: next.teamA, b: next.teamB })
  }
  for (const slide of match.value?.slides ?? []) {
    list.push({ kind: 'image', key: `img-${slide.id}`, url: slide.url })
  }
  return list
})

const tick = useSlideshowClock()

// V ukázkovém režimu jde slide připíchnout adresou (?mock&lf=next / lf=image),
// aby se dal zkontrolovat bez čekání na rotaci.
const params = new URLSearchParams(location.search)
const pinned = params.has('mock') ? params.get('lf') : null

const current = computed(() =>
  (pinned && slides.value.find((slide) => slide.kind === pinned))
  || slides.value[tick.value % slides.value.length])

function pragueTime(iso: string | null): string | null {
  if (!iso) return null
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}
</script>

<template>
  <Transition name="strip">
    <div v-if="isInGame" class="lframe">
      <Transition name="swap" mode="out-in">

        <!-- Logo ligy -->
        <div v-if="current.kind === 'brand'" :key="current.key" class="lf-slide lf-brand">
          <img src="/sponsors/logo.png" class="lf-brand__logo" alt="" />
          <span class="lf-brand__name">INFERNAL LEAGUE</span>
        </div>

        <!-- Další zápas večera -->
        <div v-else-if="current.kind === 'next'" :key="current.key" class="lf-slide lf-next">
          <span class="lf-next__label">
            DALŠÍ ZÁPAS<template v-if="current.time"> · {{ current.time }}</template>
          </span>
          <div class="lf-next__teams">
            <div class="lf-next__team">
              <img v-if="current.a.logoUrl" :src="current.a.logoUrl" class="lf-next__logo" alt="" />
              <span v-else class="lf-next__logo lf-next__logo--empty">{{ (current.a.tag ?? current.a.name)[0] }}</span>
              <span class="lf-next__name">{{ current.a.name }}</span>
            </div>
            <span class="lf-next__vs">VS</span>
            <div class="lf-next__team">
              <img v-if="current.b.logoUrl" :src="current.b.logoUrl" class="lf-next__logo" alt="" />
              <span v-else class="lf-next__logo lf-next__logo--empty">{{ (current.b.tag ?? current.b.name)[0] }}</span>
              <span class="lf-next__name">{{ current.b.name }}</span>
            </div>
          </div>
        </div>

        <!-- Obrázek z adminu přes celou plochu -->
        <img v-else :key="current.key" :src="current.url" class="lf-slide lf-image" alt="" />

      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* 305 × 221 = šířka po spodní panel a výška spodního pruhu (1 px horní linka
   + 220 px plochy). Obrázek z adminu vyplní celých 305 × 220. */
.lframe {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 305px;
  height: 221px;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
  background: var(--il-surface);
  border-top: 1px solid var(--il-line);
  border-right: 1px solid var(--il-divider);
}

.lf-slide {
  position: absolute;
  inset: 0;
}

/* ── Logo ligy ─────────────────────────────────────────────────── */
.lf-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: radial-gradient(ellipse at 50% 42%, var(--il-ember-glow) 0%, transparent 62%);
}
.lf-brand__logo {
  width: 104px;
  height: 104px;
  object-fit: contain;
  filter: drop-shadow(0 0 18px var(--il-ember-glow));
}
.lf-brand__name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 27px;
  line-height: 1;
  letter-spacing: 0.16em;
  color: var(--il-ember);
  /* Mezera za posledním písmenem by text opticky posunula doleva. */
  margin-right: -0.16em;
}

/* ── Další zápas ───────────────────────────────────────────────── */
.lf-next {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 0 14px;
}
.lf-next__label {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 18px;
  line-height: 1;
  letter-spacing: 0.14em;
  color: var(--il-ember);
}
.lf-next__teams {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.lf-next__team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.lf-next__logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}
.lf-next__logo--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--il-line);
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 28px;
  color: var(--il-text-dim);
}
.lf-next__name {
  max-width: 100%;
  overflow: hidden;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--il-text);
}
.lf-next__vs {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  color: var(--il-text-dim);
  padding-bottom: 32px; /* VS v úrovni log, ne názvů */
}

/* ── Obrázek z adminu ──────────────────────────────────────────── */
.lf-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
