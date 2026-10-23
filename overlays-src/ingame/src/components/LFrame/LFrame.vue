<script setup lang="ts">
import { computed } from 'vue'
import { useIsInGame } from '@/composables/useIngame'
import { useMatchContext, type OverlayBriefTeam } from '@/composables/useMatchContext'
import { useSlideshowClock } from '@/composables/useSlideshowClock'

const isInGame = useIsInGame()
const match = useMatchContext()

// ── L-Frame vlevo dole ──────────────────────────────────────────────────────
// Jedna plocha 310 × 220 px, která střídá:
//   1. logo ligy a pod ním INFERNAL LEAGUE (vždy),
//   2. výzvu k podpoře ligy stupněm Infernal Flame (když je stupeň zapnutý),
//   3. další zápas večera (když je),
//   4. obrázky z Admin → Media / Assets → In-game overlay (když jsou).
// Obrázky i další zápas posílá web přes agenta (useMatchContext), takže výměna
// sponzora nepotřebuje nové vydání agenta. Obrázek vyplní celou plochu,
// v adminu se proto doporučuje 620 × 440 px.
//
// Rotace jede na sdílených hodinách (useSlideshowClock), stejně jako panel
// vedle minimapy, takže se obě místa přepínají ve stejný okamžik.

type Slide =
  | { kind: 'brand'; key: string }
  | { kind: 'flame'; key: string; name: string; badgeUrl: string | null }
  | { kind: 'next'; key: string; time: string | null; a: OverlayBriefTeam; b: OverlayBriefTeam }
  | { kind: 'image'; key: string; url: string }

const slides = computed<Slide[]>(() => {
  const list: Slide[] = [{ kind: 'brand', key: 'brand' }]
  // Název a odznak stupně posílá web (Admin → Supporter tiers). Bez napojené
  // hry nebo se starším webem platí výchozí název; vypnutý stupeň (null) se
  // neukazuje.
  const supporter = match.value?.supporter
  if (supporter !== null) {
    list.push({
      kind: 'flame',
      key: 'flame',
      name: supporter?.name ?? 'Infernal Flame',
      badgeUrl: supporter?.badgeUrl ?? null,
    })
  }
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

// Jiskry nad logem ligy: pevné pozice a časy, ať se overlay po refreshi
// nechová pokaždé jinak (x v px od levého okraje L-Framu, délka a zpoždění
// v sekundách, dx = boční drift).
const SPARKS = [
  { x: 96, d: 3.4, delay: 0.0, dx: -12 }, { x: 118, d: 4.1, delay: 1.2, dx: 8 },
  { x: 132, d: 3.0, delay: 2.6, dx: -6 }, { x: 146, d: 4.6, delay: 0.7, dx: 14 },
  { x: 158, d: 3.7, delay: 3.1, dx: -16 }, { x: 170, d: 2.9, delay: 1.8, dx: 6 },
  { x: 182, d: 4.3, delay: 0.3, dx: -8 }, { x: 194, d: 3.2, delay: 2.2, dx: 12 },
  { x: 206, d: 4.8, delay: 3.6, dx: -4 }, { x: 218, d: 3.5, delay: 1.0, dx: 10 },
  { x: 140, d: 4.0, delay: 4.2, dx: 16 }, { x: 176, d: 3.3, delay: 4.6, dx: -14 },
]

// V ukázkovém režimu jde slide připíchnout adresou (?mock&lf=flame / lf=next / lf=image),
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
          <!-- Jiskry stoupají za logem, logo pomalu „dýchá" září. -->
          <div class="lf-sparks" aria-hidden="true">
            <span
              v-for="(spark, i) in SPARKS"
              :key="i"
              class="lf-spark"
              :style="{ left: spark.x + 'px', '--d': spark.d + 's', '--delay': spark.delay + 's', '--dx': spark.dx + 'px' }"
            />
          </div>
          <div class="lf-brand__mark">
            <span class="lf-brand__halo" />
            <img src="/sponsors/logo.png" class="lf-brand__logo" alt="" />
          </div>
          <span class="lf-brand__name il-fire">INFERNAL LEAGUE</span>
        </div>

        <!-- Výzva k podpoře ligy -->
        <div v-else-if="current.kind === 'flame'" :key="current.key" class="lf-slide lf-flame">
          <div class="lf-sparks" aria-hidden="true">
            <span
              v-for="(spark, i) in SPARKS"
              :key="i"
              class="lf-spark"
              :style="{ left: spark.x + 'px', '--d': spark.d + 's', '--delay': spark.delay + 's', '--dx': spark.dx + 'px' }"
            />
          </div>
          <span class="lf-flame__kicker">PODPOŘ LIGU</span>
          <div class="lf-flame__head">
            <img v-if="current.badgeUrl" :src="current.badgeUrl" class="lf-flame__badge" alt="" />
            <img v-else src="/sponsors/logo.png" class="lf-flame__badge" alt="" />
            <span class="lf-flame__name il-fire">{{ current.name }}</span>
          </div>
          <span class="lf-flame__cta">
            <b>Discord → #subscription</b>
            nebo v panelu pod streamem
          </span>
        </div>

        <!-- Další zápas večera -->
        <div v-else-if="current.kind === 'next'" :key="current.key" class="lf-slide lf-next">
          <span class="lf-next__label il-fire">
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
/* 310 × 221 = šířka po spodní panel a výška spodního pruhu (1 px horní linka
   + 220 px plochy). Obrázek z adminu vyplní celých 310 × 220. */
.lframe {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 310px;
  height: 221px;
  overflow: hidden;
  pointer-events: none;
  z-index: 10;
  background: var(--il-surface);
  border-top: 1px solid var(--il-line);
}

/* Svislá ohnivá linka k panelu hráčů, dolů slábne. */
.lframe::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: var(--il-divider-fire);
  z-index: 2;
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
.lf-brand__mark {
  position: relative;
  width: 104px;
  height: 104px;
}
/* Záře za logem a logo samotné pulzují v jednom rytmu (4 s). */
.lf-brand__halo {
  position: absolute;
  inset: -26px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 120, 20, 0.45) 0%, transparent 62%);
  animation: lf-halo 4s ease-in-out infinite;
}
.lf-brand__mark .lf-brand__logo {
  position: relative;
  animation: lf-breathe 4s ease-in-out infinite;
}
@keyframes lf-breathe {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.045); }
}
@keyframes lf-halo {
  0%, 100% { opacity: 0.25; transform: scale(0.94); }
  50%      { opacity: 0.75; transform: scale(1.06); }
}

.lf-sparks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.lf-spark {
  position: absolute;
  bottom: -6px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #ffb347;
  box-shadow: 0 0 6px 1px rgba(255, 140, 0, 0.8);
  opacity: 0;
  animation: lf-rise var(--d) linear var(--delay) infinite;
}
@keyframes lf-rise {
  0%   { transform: translate(0, 0) scale(1); opacity: 0; }
  10%  { opacity: 1; }
  100% { transform: translate(var(--dx), -190px) scale(0.4); opacity: 0; }
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

/* ── Výzva k podpoře (Infernal Flame) ─────────────────────────── */
.lf-flame {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 16px;
  text-align: center;
  background: radial-gradient(ellipse at 50% 46%, var(--il-ember-glow) 0%, transparent 66%);
}
.lf-flame__kicker {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  letter-spacing: 0.22em;
  margin-right: -0.22em;
  color: var(--il-text-dim);
}
.lf-flame__head {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
}
.lf-flame__badge {
  width: 58px;
  height: 58px;
  flex-shrink: 0;
  object-fit: contain;
  filter: drop-shadow(0 0 14px var(--il-ember-glow));
}
.lf-flame__name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 30px;
  line-height: 0.95;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: left;
  color: var(--il-ember);
}
.lf-flame__cta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: 16px;
  line-height: 1.15;
  color: var(--il-text-dim);
}
.lf-flame__cta b {
  font-weight: 700;
  font-size: 19px;
  letter-spacing: 0.02em;
  color: var(--il-text);
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
