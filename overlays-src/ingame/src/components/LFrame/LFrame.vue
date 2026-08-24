<script setup lang="ts">
import { computed } from 'vue'
import { useIsInGame } from '@/composables/useIngame'
import { useSlideshowClock } from '@/composables/useSlideshowClock'

const isInGame = useIsInGame()

// ── Rotující prezentace (spodní 2/3) ──────────────────────────────────────
// Sponzorské bannery se auto-detekují ze složky `src/assets/sponsors/`.
// Chceš přidat další? Prostě tam hoď soubor (banner4.png, sponsor-x.png, ...) —
// Vite ho po restartu dev serveru (nebo `npm run build`) rovnou zařadí.
// Podporované formáty: PNG, JPG, JPEG, WEBP, SVG, GIF.
// Řadí se abecedně podle názvu souboru.
//
// Rotace jede na sdílených hodinách (useSlideshowClock) — banner v LFramu i
// texty v PatchPanelu vedle mapy se tak přepínají naráz ve stejný okamžik.

interface Slide {
  type: 'text' | 'image' | 'video'
  content: string   // text nebo src URL
  subtitle?: string
}

// eager: true → obrázky se rovnou zabalí do bundle (žádný async import za běhu)
const bannerModules = import.meta.glob<{ default: string }>(
  '@/assets/sponsors/*.{png,jpg,jpeg,webp,svg,gif}',
  { eager: true },
)
const bannerUrls = Object.entries(bannerModules)
  .sort(([a], [b]) => a.localeCompare(b))       // abecední pořadí podle názvu souboru
  .map(([, mod]) => mod.default)

const slides: Slide[] = bannerUrls.map(url => ({ type: 'image', content: url }))

// Fallback: kdyby složka byla prázdná, ať se nezobrazí prázdný L Frame věčně
if (slides.length === 0) {
  slides.push({ type: 'text', content: 'INFERNAL LEAGUE', subtitle: 'SEASON 2026' })
}

// Sdílený tik (společný pro LFrame i PatchPanel) → slide index tohoto slideshow.
const tick = useSlideshowClock()
const slideIdx = computed(() => tick.value % slides.length)
const current = computed(() => slides[slideIdx.value])
</script>

<template>
  <Transition name="lf">
    <div v-if="isInGame" class="lframe">

      <!-- ① Header (1/3): logo + název ligy -->
      <div class="lframe__header">
        <!-- Logo slot: vyměň div za <img src="/logo.png" class="lframe__logo-img" /> -->
        <img src="/sponsors/logo.png" class="lframe__logo-img" alt="" />
        <div class="lframe__league-name">
          <span class="lframe__league-line1">INFERNAL</span>
          <span class="lframe__league-line2">LEAGUE</span>
        </div>
      </div>

      <!-- ② Body (2/3): rámeček s insetem → rotující prezentace uvnitř -->
      <div class="lframe__body">
        <div class="lframe__frame">
          <Transition name="slide" mode="out-in">
            <div :key="slideIdx" class="lframe__slide" :class="{ 'lframe__slide--media': current.type !== 'text' }">
              <img
                v-if="current.type === 'image'"
                :src="current.content"
                class="lframe__slide-img"
                alt=""
              />
              <video
                v-else-if="current.type === 'video'"
                :src="current.content"
                class="lframe__slide-img"
                autoplay
                loop
                muted
                playsinline
              />
              <template v-else>
                <div class="lframe__slide-text">{{ current.content }}</div>
                <div v-if="current.subtitle" class="lframe__slide-sub">
                  {{ current.subtitle }}
                </div>
              </template>
            </div>
          </Transition>
        </div>
      </div>

    </div>
  </Transition>
</template>

<style scoped>
/* ── Outer container ─────────────────────────────────────────────── */
/* width: 305px = BottomPanel left offset → žádná mezera mezi nimi  */
/* height: 220px = topline(2) + padding(16) + rows(190) + gaps(12) */
.lframe {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 305px;
  height: 221px; /* border-box: 220px content + 1px border-top = 221px outer, matches BottomPanel */
  display: grid;
  /* header spans panel-top → sponsor-frame-top (logo+name centered in it);
     body holds the 288×144 frame (151 − 7px bottom padding = 144) */
  grid-template-rows: 69px 151px;
  pointer-events: none;
  z-index: 10;
  background: #090502;
  border-top: 1px solid rgba(249, 115, 22, 0.14);
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 4px -4px 32px rgba(0, 0, 0, 0.40);
}

/* ── Header (1/3): logo + název ligy ────────────────────────────── */
.lframe__header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 12px; /* vertically centered — 60px logo fits the 62px header */
  overflow: hidden;
}

/* Logo box — nahraď za <img src="/logo.png" class="lframe__logo-img" /> */
.lframe__logo {
  width: 72px;
  height: 72px;
  border-radius: 6px;
  background: linear-gradient(135deg, rgba(249, 115, 22, 0.22), rgba(251, 188, 35, 0.12));
  border: 1px solid rgba(249, 115, 22, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.lframe__logo-text {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 16px;
  letter-spacing: 0.05em;
  color: #fbbc23;
  line-height: 1;
}

.lframe__logo-img {
  width: 60px;
  height: 60px;
  object-fit: contain;
  flex-shrink: 0;
}

.lframe__league-name {
  display: flex;
  flex-direction: column;
  line-height: 1;
  gap: 1px;
}

.lframe__league-line1 {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 26px;
  letter-spacing: 0.12em;
  color: rgba(249, 115, 22, 0.90);
}

.lframe__league-line2 {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 26px;
  letter-spacing: 0.12em;
  color: rgba(249, 115, 22, 0.90);
}

/* ── Body (2/3): padding → rámeček s prezentací ─────────────────── */
.lframe__body {
  padding: 0 8px 7px 8px; /* no top padding — frame top aligns with header bottom */
  overflow: hidden;
}

/* Viditelný rámeček — vyplní celou vnitřní plochu body. */
.lframe__frame {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 4px;
  background: rgba(249, 115, 22, 0.04);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/* Border drawn as an overlay ON TOP of the banner (pseudo-element paints after
   the child slide), so a full-bleed 288×144 banner fills the whole box and the
   1px orange line sits over its outer edge — banner tucks ~1px behind the frame. */
.lframe__frame::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  border-radius: 4px;
  /* Thick frame overlaying the banner edges: solid orange at the very edge,
     fading to fully transparent toward the center on all four sides. */
  background:
    linear-gradient(to bottom, rgba(249, 115, 22, 1) 0%, rgba(249, 115, 22, 0) 100%) top    / 100% 10px no-repeat,
    linear-gradient(to top,    rgba(249, 115, 22, 1) 0%, rgba(249, 115, 22, 0) 100%) bottom / 100% 10px no-repeat,
    linear-gradient(to right,  rgba(249, 115, 22, 1) 0%, rgba(249, 115, 22, 0) 100%) left   / 10px 100% no-repeat,
    linear-gradient(to left,   rgba(249, 115, 22, 1) 0%, rgba(249, 115, 22, 0) 100%) right  / 10px 100% no-repeat;
}

.lframe__slide {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  text-align: center;
  padding: 0 10px;
  width: 100%;
}

/* Image / video slides fill the entire frame edge-to-edge (no padding, no letterbox) */
.lframe__slide--media {
  position: absolute;
  inset: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}

.lframe__slide-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.lframe__slide--media .lframe__slide-img {
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  object-fit: cover;
  display: block;
}

.lframe__slide-text {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 18px;
  letter-spacing: 0.10em;
  color: rgba(249, 115, 22, 0.90);
  white-space: nowrap;
  line-height: 1;
}

.lframe__slide-sub {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 10px;
  letter-spacing: 0.22em;
  color: rgba(255, 255, 255, 0.38);
  text-transform: uppercase;
  white-space: nowrap;
}

/* ── Transitions ─────────────────────────────────────────────────── */
.lf-enter-active {
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.lf-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.lf-enter-from,
.lf-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}

.slide-enter-active { transition: opacity 0.4s ease; }
.slide-leave-active { transition: opacity 0.25s ease; }
.slide-enter-from,
.slide-leave-to     { opacity: 0; }
</style>
