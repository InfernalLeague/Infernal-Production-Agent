<script setup lang="ts">
import { computed } from 'vue'
import BanSlot  from './BanSlot.vue'
import PickSlot from './PickSlot.vue'
import { useChampSelectSelector } from '@/composables/useChampSelect'
import { useLiveConfig } from '@/composables/useLiveConfig'
import { useFearlessBans, type FearlessChamp } from '@/composables/useFearlessBans'
import { useClient } from '@/client'
// Import (ne veřejná cesta) → Vite ho v single-file buildu zainlinuje jako
// data URI, takže logo funguje i přes file:// v OBS.
import ilLogoSrc from '@/assets/il-logo.png'

const client   = useClient()
const cacheUrl = (path?: string) => (path ? client.getCacheUrl(path) : undefined)

// Auto-shrink coach label: pokud se jméno nevejde do max-width lišty banů,
// zmenší font-size dolů po 1px z 13 na 9, dokud se neschová.
// Rajdhani je z Google Fonts (display=swap) — po document.fonts.ready se
// přeměří, aby první render s fallback fontem neuvázl na 13 px.
function fitCoachLabel(el: HTMLElement): void {
  const max = 13
  const min = 9
  const shrink = (): void => {
    el.style.fontSize = max + 'px'
    let fs = max
    let guard = 20
    while (el.scrollWidth > el.clientWidth && fs > min && guard-- > 0) {
      fs -= 1
      el.style.fontSize = fs + 'px'
    }
  }
  shrink()
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => { shrink(); requestAnimationFrame(shrink) })
  }
}
const vFitCoach = {
  mounted(el: HTMLElement) { fitCoachLabel(el) },
  updated(el: HTMLElement) { fitCoachLabel(el) },
}

const champData = useChampSelectSelector((s) => s.champSelectData, null as any)
const isActive  = useChampSelectSelector((s) => s.isActive, false)

const blueTeam = computed(() => champData.value?.blueTeam)
const redTeam  = computed(() => champData.value?.redTeam)
const timer    = computed(() => champData.value?.timer)
const meta     = computed(() => champData.value?.metaData)

// ── Live-game config (Supabase) ─────────────────────────────────────────────
// Operator-configured player names per side, in role order (TOP→SUPPORT).
// These REPLACE the BlueBottle names; champions are mapped by side + slot index.
// Season W-L is also computed here (from public.matches) — BlueBottle's
// scoreSeason is unreliable because it must be keyed in per broadcast.
// Coach names come from public.teams.coach (set in admin → Týmy).
const {
  blue: liveBlue,
  red:  liveRed,
  blueRecord: liveBlueRecord,
  redRecord:  liveRedRecord,
  blueCoach:  liveBlueCoach,
  redCoach:   liveRedCoach,
} = useLiveConfig()

// ── Timer ─────────────────────────────────────────────────────────────────
const timerProgress = computed(() => {
  const t = timer.value
  if (!t || t.phaseDuration === 0) return 1
  return Math.max(0, t.timeRemaining / t.phaseDuration)
})

const isUrgent = computed(() => {
  const r = timer.value?.timeRemaining ?? 1
  return r > 0 && r <= 5
})

// BlueBottle sends bestOfType as the ENUM NAME string, e.g. "BestOf3" — not the
// number 3. Parse the trailing digits. Falls back to metaData.matchData.type.
// Always a safe positive integer so the win-dots v-for never builds an
// invalid-length array (RangeError: Invalid array length).
function parseBestOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
  if (typeof v === 'string') {
    const m = v.match(/(\d+)/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}
const bestOf = computed(() => {
  for (const c of [meta.value?.bestOfType, meta.value?.matchData?.type]) {
    const n = parseBestOf(c)
    if (n && n > 0) return n
  }
  return 1
})
const isBO1   = computed(() => bestOf.value === 1)
const maxWins = computed(() => {
  const n = Math.ceil(bestOf.value / 2)
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 9) : 1
})

// ── Score mapping (verified against live data) ──────────────────────────────
// scoreMatch = current series state (e.g. 1-1 in a Bo3)      → win dots (BlueBottle)
// season W-L (e.g. 7-3) for Bo1 text comes from Supabase via live_config —
// computed from actual matches for the two configured team_ids, so we don't
// depend on an operator keying scoreSeason into BlueBottle for every draft.
const ZERO = { wins: 0, losses: 0 }
const blueSeries = computed(() => blueTeam.value?.scoreMatch ?? ZERO)
const redSeries  = computed(() => redTeam.value?.scoreMatch  ?? ZERO)
const blueTotal  = computed(() => liveBlueRecord.value)
const redTotal   = computed(() => liveRedRecord.value)
// ── Patch ─────────────────────────────────────────────────────────────────
// BlueBottle sends season-based patch (e.g. "16.11").
// Display uses year-based format: season + 10 → "26.11" (same as ingame overlay).
const patch = computed(() => {
  const p = meta.value?.patch
  if (!p || typeof p !== 'string') return null
  const parts = p.split('.')
  if (parts.length < 2) return p
  const season = parseInt(parts[0], 10)
  const major  = Number.isFinite(season) ? season + 10 : parts[0]
  return `${major}.${parts[1]}`
})

// Pick slots are in role order (index 0 = TOP … 4 = SUPPORT).
const ROLE_NAMES = ['top', 'jungle', 'mid', 'adc', 'support'] as const

// ── Entrance choreography timing ────────────────────────────────────────────
// Phase 1: center cluster slides up (0 → ~0.5s).
// Phase 2: cards cascade outward from center, innermost first.
// Phase 3: bans / fearless / timer appear together with the LAST (outermost) card.
const ENTER_BASE = 0.65   // cards start after the center has landed
const ENTER_STEP = 0.12   // stagger between adjacent cards
// Blue: innermost is index 4 (support, nearest center) → outermost index 0 (top).
const blueDelay = (i: number) => ENTER_BASE + (4 - i) * ENTER_STEP
// Red: innermost is index 0 (nearest center) → outermost index 4.
const redDelay  = (i: number) => ENTER_BASE + i * ENTER_STEP
// Bans/fearless/timer fire with the outermost card.
const lastCardDelay = ENTER_BASE + 4 * ENTER_STEP

// ── Helpers ────────────────────────────────────────────────────────────────
function makeBans(team: typeof blueTeam.value) {
  const raw    = team?.bans ?? []
  const result = raw.map((b) => ({
    isActive: b.isActive,
    imgUrl:   cacheUrl(b.champion?.squareImg),
    name:     b.champion?.name,
  }))
  while (result.length < 5) result.push({ isActive: false, imgUrl: undefined, name: undefined })
  return result
}

function makeSlots(team: typeof blueTeam.value, liveCfg: { name: string }[] = []) {
  const raw    = team?.slots ?? []
  const result = raw.map((s, i) => ({
    isActive:      s.isActive,
    role:          ROLE_NAMES[i] ?? 'top',
    // Name priority:
    //  1. Operator-configured live-game name for this side+slot — authoritative
    //  2. Raw BlueBottle slot player name — fallback (DevMock / unset config)
    player:        liveCfg[i]?.name?.trim() || s.player,
    championName:  s.champion?.name,
    loadingImgUrl: cacheUrl(s.champion?.loadingImg),
  }))
  while (result.length < 5) result.push({ isActive: false, role: ROLE_NAMES[result.length] ?? 'top', player: '', championName: undefined, loadingImgUrl: undefined })
  return result
}

const blueSlots = computed(() => makeSlots(blueTeam.value, liveBlue.value))
const redSlots  = computed(() => makeSlots(redTeam.value,  liveRed.value))

// ── Fearless series picks (REST: { [gameId]: { [teamId]: champs[] } }) ───────
// In a fearless series the champions PICKED in previous games are locked out of
// later games. We show them grouped per already-played game, both teams together.
const { bans: fearlessRaw } = useFearlessBans()

interface SeriesGame {
  gameNum:    number
  blueChamps: FearlessChamp[]
  redChamps:  FearlessChamp[]
}

// Number of COMPLETED games in the series = wins on both sides (scoreMatch is
// verified reliable). The current, in-progress game is NOT counted, so we use
// this to hard-cap how many game groups we show — even if the champ-select
// endpoint starts propagating the current game's live picks into the map.
const gamesPlayed = computed(() => (blueSeries.value.wins ?? 0) + (redSeries.value.wins ?? 0))

// One group per already-played game. gameId ascending → the first played game is
// GAME 1. A series is max 5 games, so at most 4 previous games are ever shown.
// Games with no picks on either side (current / not-yet-played) are skipped.
// The result is additionally capped to gamesPlayed so the CURRENT game's picks
// never appear live — in game 3 only games 1 & 2 show, etc.
const seriesGames = computed<SeriesGame[]>(() => {
  const map     = fearlessRaw.value
  const blueId  = blueTeam.value?.metaData?.teamId
  const redId   = redTeam.value?.metaData?.teamId
  const gameIds = Object.keys(map).map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  const out: SeriesGame[] = []
  for (const gid of gameIds) {
    const blueChamps = (blueId != null ? map[gid]?.[blueId] : undefined) ?? []
    const redChamps  = (redId  != null ? map[gid]?.[redId]  : undefined) ?? []
    if (blueChamps.length === 0 && redChamps.length === 0) continue
    out.push({ gameNum: out.length + 1, blueChamps, redChamps })
  }
  // Only completed games (max 4 previous in a 5-game series). Capping by
  // gamesPlayed drops the current game group if it's being filled in live.
  return out.slice(0, Math.min(4, gamesPlayed.value))
})

const showFearless = computed(() => bestOf.value > 1 && seriesGames.value.length > 0)

// Dynamic icon sizing: every game group must fit inside the same fixed max panel
// width, so the more champs are on screen the smaller each icon becomes. Purely
// deterministic from the current game/champ counts (no DOM measuring needed).
// Blue and red picks are STACKED (blue over red), so a game's width is driven by
// the wider of its two rows — max(blue, red) icons — not the sum of both.
const SERIES_PANEL_MAX_W = 1180  // px — icon-area budget of the centered panel
const SERIES_ICON_MAX    = 38
const SERIES_ICON_MIN    = 18
const SERIES_ICON_GAP    = 3     // px between adjacent icons (keep in sync w/ CSS)
const seriesIconSize = computed(() => {
  const games = seriesGames.value
  // Widest row per game summed across games = how many icons must fit side by side.
  const rowIcons = games.reduce((n, g) => n + Math.max(g.blueChamps.length, g.redChamps.length), 0)
  if (rowIcons === 0) return SERIES_ICON_MAX
  const GAME_SEP = 30   // separator + gaps between two adjacent games
  const overhead = Math.max(0, games.length - 1) * GAME_SEP
  const avail   = SERIES_PANEL_MAX_W - overhead
  const perIcon = avail / rowIcons - SERIES_ICON_GAP
  return Math.max(SERIES_ICON_MIN, Math.min(SERIES_ICON_MAX, Math.floor(perIcon)))
})

// ── Ban groups: phase 1 = first 3 bans, phase 2 = last 2 bans ─────────────
const blueBansP1 = computed(() => makeBans(blueTeam.value).slice(0, 3))
const blueBansP2 = computed(() => makeBans(blueTeam.value).slice(3, 5))
const redBansP1  = computed(() => makeBans(redTeam.value).slice(0, 3))
const redBansP2  = computed(() => makeBans(redTeam.value).slice(3, 5))
</script>

<template>
  <Transition name="slide-up">
  <div v-if="isActive && champData" class="pickban-strip">

    <!-- ── 1. BANS ROW — coach label sits above each side's bans; the fearless
         SERIES PICKS panel is centered on the SAME line, in the empty middle. ──
      Blue: [ban0][ban1][ban2] | sep | [ban3][ban4]  — left edge → center
      Red:  mirrored via row-reverse → [ban4][ban3] | sep | [ban2][ban1][ban0]
    -->
    <div class="bans-row" :style="{ animationDelay: `${lastCardDelay}s` }">

      <!-- ── 0. SERIES PICKS PANEL (BO3/BO5 fearless) ────────────────────
        Absolutely centered in the middle of the bans row (the empty gap between
        the two teams' bans). One group per already-played game; each group holds
        both teams' picked champs (blue | red) split by a divider. Groups grow
        symmetrically from the middle; icons shrink so all games fit the max width.
      -->
      <div v-if="showFearless" class="series-picks" :style="{ animationDelay: `${lastCardDelay}s` }">
        <div class="sp-inner">
          <template v-for="(game, gi) in seriesGames" :key="'sg-' + game.gameNum">
            <div v-if="gi > 0" class="sp-sep" />
            <div class="sp-game">
              <div class="sp-label">GAME {{ game.gameNum }}</div>
              <div class="sp-icons">
                <div class="sp-team sp-team--blue">
                  <img
                    v-for="(c, i) in game.blueChamps"
                    :key="'sgb-' + game.gameNum + '-' + i"
                    :src="cacheUrl(c.squareImg)"
                    :alt="c.name"
                    class="sp-icon"
                    :style="{ width: seriesIconSize + 'px', height: seriesIconSize + 'px' }"
                  />
                </div>
                <div class="sp-divider" />
                <div class="sp-team sp-team--red">
                  <img
                    v-for="(c, i) in game.redChamps"
                    :key="'sgr-' + game.gameNum + '-' + i"
                    :src="cacheUrl(c.squareImg)"
                    :alt="c.name"
                    class="sp-icon"
                    :style="{ width: seriesIconSize + 'px', height: seriesIconSize + 'px' }"
                  />
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Blue side: coach label on top, bans below -->
      <div class="bans-side bans-side--blue">
        <div v-if="liveBlueCoach" v-fit-coach class="bans-coach">COACH: {{ liveBlueCoach.toUpperCase() }}</div>
        <div class="bans-group">
          <BanSlot
            v-for="(ban, i) in blueBansP1"
            :key="'blp1-' + i"
            :img-url="ban.imgUrl"
            :name="ban.name"
            :is-active="ban.isActive"
            :minimal="true"
          />
          <div class="bans-sep" />
          <BanSlot
            v-for="(ban, i) in blueBansP2"
            :key="'blp2-' + i"
            :img-url="ban.imgUrl"
            :name="ban.name"
            :is-active="ban.isActive"
            :minimal="true"
          />
        </div>
      </div>

      <!-- Red side: coach label on top, bans below (mirrored right) -->
      <div class="bans-side bans-side--red">
        <div v-if="liveRedCoach" v-fit-coach class="bans-coach">COACH: {{ liveRedCoach.toUpperCase() }}</div>
        <div class="bans-group bans-group--rev">
          <BanSlot
            v-for="(ban, i) in redBansP1"
            :key="'rep1-' + i"
            :img-url="ban.imgUrl"
            :name="ban.name"
            :is-active="ban.isActive"
            :minimal="true"
          />
          <div class="bans-sep" />
          <BanSlot
            v-for="(ban, i) in redBansP2"
            :key="'rep2-' + i"
            :img-url="ban.imgUrl"
            :name="ban.name"
            :is-active="ban.isActive"
            :minimal="true"
          />
        </div>
      </div>

    </div>

    <!-- ── Dark panel: timer bar + picks row ── -->
    <div class="pickban-panel">

    <!-- ── 2. TIMER BAR — two halves shrinking from edges toward center ── -->
    <div class="timer-bar-track" :style="{ animationDelay: `${lastCardDelay}s` }">
      <div
        class="timer-bar-half timer-bar-half--left"
        :class="isUrgent && 'timer-bar-half--urgent'"
        :style="{ transform: `scaleX(${timerProgress})` }"
      />
      <div
        class="timer-bar-half timer-bar-half--right"
        :class="isUrgent && 'timer-bar-half--urgent'"
        :style="{ transform: `scaleX(${timerProgress})` }"
      />
    </div>

    <!-- ── 3. PICKS ROW ── -->
    <!-- Width: 5×150 + 150 + 120 + 150 + 5×150 = 1920px -->
    <div class="picks-row">

      <!-- [A] 5 blue pick cards — cascade outward to the LEFT -->
      <div class="picks-group picks-group--blue">
        <PickSlot
          v-for="(slot, i) in blueSlots"
          :key="'bp' + i"
          :player="slot.player"
          :champion-name="slot.championName"
          :loading-img-url="slot.loadingImgUrl"
          :is-active="slot.isActive"
          :role="slot.role"
          :delay="blueDelay(i)"
          side="blue"
        />
      </div>

      <!-- ── CENTER CLUSTER: blue team | logo | red team (slides up first) ── -->
      <div class="center-cluster">

      <!-- [B] Blue team info: score ↑ | logo | name ↓ -->
      <div class="team-slot team-slot--blue">
        <!-- BO1: total season record as text (7-1, 5-2…) -->
        <div v-if="isBO1" class="ts-season-score ts-season-score--blue">
          {{ blueTotal.wins }}-{{ blueTotal.losses }}
        </div>
        <!-- BO3 / BO5: current series win dots in team color -->
        <div v-else class="ts-score">
          <div
            v-for="i in maxWins"
            :key="i"
            class="ts-dot"
            :class="i <= blueSeries.wins ? 'ts-dot--blue-win' : ''"
          />
        </div>
        <img
          v-if="cacheUrl(blueTeam?.metaData?.iconUri)"
          :src="cacheUrl(blueTeam?.metaData?.iconUri)"
          :alt="blueTeam?.metaData?.name"
          class="ts-logo"
        />
        <div v-else class="ts-logo-placeholder">{{ blueTeam?.metaData?.tag ?? '?' }}</div>
        <div class="ts-name">{{ blueTeam?.metaData?.name ?? 'Blue Team' }}</div>
      </div>

      <!-- [C] League logo + patch -->
      <div class="logo-slot">
        <img :src="ilLogoSrc" class="logo-img" alt="Infernal League" />
        <div v-if="patch" class="logo-patch">{{ patch }}</div>
      </div>

      <!-- [D] Red team info: score ↑ | logo | name ↓ -->
      <div class="team-slot team-slot--red">
        <!-- BO1: total season record as text -->
        <div v-if="isBO1" class="ts-season-score ts-season-score--red">
          {{ redTotal.wins }}-{{ redTotal.losses }}
        </div>
        <!-- BO3 / BO5: current series win dots in team color -->
        <div v-else class="ts-score">
          <div
            v-for="i in maxWins"
            :key="i"
            class="ts-dot"
            :class="i <= redSeries.wins ? 'ts-dot--red-win' : ''"
          />
        </div>
        <img
          v-if="cacheUrl(redTeam?.metaData?.iconUri)"
          :src="cacheUrl(redTeam?.metaData?.iconUri)"
          :alt="redTeam?.metaData?.name"
          class="ts-logo"
        />
        <div v-else class="ts-logo-placeholder">{{ redTeam?.metaData?.tag ?? '?' }}</div>
        <div class="ts-name">{{ redTeam?.metaData?.name ?? 'Red Team' }}</div>
      </div>

      </div><!-- end center-cluster -->

      <!-- [E] 5 red pick cards — cascade outward to the RIGHT -->
      <div class="picks-group picks-group--red">
        <PickSlot
          v-for="(slot, i) in redSlots"
          :key="'rp' + i"
          :player="slot.player"
          :champion-name="slot.championName"
          :loading-img-url="slot.loadingImgUrl"
          :is-active="slot.isActive"
          :role="slot.role"
          :delay="redDelay(i)"
          side="red"
        />
      </div>

    </div>

    </div><!-- end pickban-panel -->
  </div>
  </Transition>
</template>

<style scoped>
/* ─── Staged entrance choreography ────────────────────────────────────────
   Phase 1 (0.00s): center cluster (logo + teams) slides up from bottom
   Phase 2 (0.50s): blue picks unfold left, red picks unfold right (from center)
   Phase 3 (1.00s): bans + fearless + timer bar fade in
   Leave: whole strip slides down + fades out.
   ───────────────────────────────────────────────────────────────────────── */

/* Enter is instant on the root; children animate via their own keyframes. */
.slide-up-leave-active {
  transition: transform 0.4s cubic-bezier(0.55, 0, 0.55, 0.2), opacity 0.4s ease;
}
.slide-up-leave-to {
  transform: translateY(40px);
  opacity: 0;
}

/* Phase 1 — center cluster rises from below the panel */
.center-cluster {
  display: flex;
  flex-direction: row;
  width: 420px;        /* 150 team + 120 logo + 150 team */
  flex-shrink: 0;
  position: relative;
  z-index: 2;          /* sits above picks so they can tuck behind it */
  animation: cluster-up 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes cluster-up {
  from { transform: translateY(115%); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

/* Phase 2 — pick groups: layout wrappers; individual cards animate themselves
   (per-card stagger lives in PickSlot.vue, delay passed via :delay prop). */
.picks-group {
  display: flex;
  flex-direction: row;
  width: 750px;        /* 5 × 150px */
  flex-shrink: 0;
  position: relative;
  z-index: 1;          /* below center cluster so cards tuck behind it */
}

/* Phase 3 — bans / series-ban / timer fade + rise; delay bound inline so it
   stays in sync with the outermost card (lastCardDelay). */
.series-picks,
.bans-row,
.timer-bar-track {
  animation: fade-in 0.65s ease both;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ─── Strip container ──────────────────────────────────────────────────── */
.pickban-strip {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1920px;
  display: flex;
  flex-direction: column;
  /* transparentní — background začíná až u dark panelu */
}

/* ─── 0. Series picks panel (BO3/BO5 fearless) ───────────────────────
   Centered horizontal panel above the draft. One group per already-played
   game, both teams' picks side by side (blue | red). Groups grow outward
   from the middle (justify-content: center), not stretched full-width.
   Only visible in Bo3/Bo5 with at least one prior game played. */
.series-picks {
  /* Sits on the SAME line as the bans, centered in the empty middle gap.
     left/right:0 + justify-center centers the pill without a transform, so the
     fade-in translateY animation stays intact. */
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;                  /* pill icon baseline lines up with the ban icons */
  display: flex;
  justify-content: center;
  padding: 0;
  pointer-events: none;
}

/* The pill that actually holds the game groups */
.sp-inner {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: center;
  max-width: 1280px;
  /* Asymmetric bottom padding lands the icon baseline on the ban-icon baseline
     so the pill reads on the SAME line as the bans (rest state, transform 0). */
  padding: 8px 22px 4px;
  background: rgba(6, 4, 10, 0.9);
  border: 1px solid rgba(200, 160, 80, 0.15);
  border-radius: 8px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

/* One game = "GAME N" label above a row of [blue picks | red picks] */
.sp-game {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.sp-label {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.22em;
  color: #cdbfa4;
  text-transform: uppercase;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

/* Blue picks stacked over red picks (column); stretch so the divider spans the
   full width of the wider row. */
.sp-icons {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
}

/* A team's picked champs (one row); centered so a short row stays under the game */
.sp-team {
  display: flex;
  flex-direction: row;
  justify-content: center;
  gap: 3px;   /* == SERIES_ICON_GAP */
}

/* Horizontal divider between the blue (top) and red (bottom) rows of one game */
.sp-divider {
  height: 2px;
  margin: 1px 0;
  border-radius: 1px;
  background: linear-gradient(to right, rgba(251, 188, 35, 0.55), rgba(239, 68, 68, 0.55));
}

/* Separator between two adjacent games */
.sp-sep {
  width: 1px;
  align-self: stretch;
  margin: 0 14px 2px;   /* ≈ GAME_SEP budget */
  background: rgba(200, 160, 80, 0.22);
}

.sp-icon {
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
  filter: saturate(0.9) brightness(0.85);
}

.sp-team--blue .sp-icon { border: 1px solid rgba(251, 188, 35, 0.55); }
.sp-team--red  .sp-icon { border: 1px solid rgba(239, 68, 68, 0.55); }

/* ─── 1. Bans row — transparentní, coach labely nad ikonami ──────────── */
.bans-row {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  justify-content: space-between;
  position: relative;   /* anchor for the centered series-picks panel */
}

/* Vertical stack: [COACH: X] over [ban icons] */
.bans-side {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.bans-side--blue { align-items: flex-start; }
.bans-side--red  { align-items: flex-end;   }

/* "COACH: X" label sitting above the ban icons, team-colored.
   Pevný rozpočet šířky — v-fit-coach direktiva zmenší font, když se jméno nevejde.
   Šířka odpovídá řadě banů pod tím (5 × 48px + gapy + separator ≈ 275px). */
.bans-coach {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.22em;
  padding: 2px 10px 3px;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  max-width: 275px;
  box-sizing: border-box;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

.bans-side--blue .bans-coach {
  color: #fbbc23;
  text-shadow: 0 0 8px rgba(251, 188, 35, 0.5), 0 1px 4px rgba(0, 0, 0, 0.9);
}

.bans-side--red .bans-coach {
  color: #ef4444;
  text-shadow: 0 0 8px rgba(239, 68, 68, 0.5), 0 1px 4px rgba(0, 0, 0, 0.9);
}

/* ─── Dark panel (timer + picks) ─────────────────────────────────────── */
.pickban-panel {
  display: flex;
  flex-direction: column;
  background: rgba(6, 4, 10, 0.94);
  border-top: 1px solid rgba(200, 160, 80, 0.12);
  overflow: hidden;
}

.bans-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  flex-shrink: 0;
}

/* row-reverse: ban[0] ends up at the far-right edge */
.bans-group--rev {
  flex-direction: row-reverse;
}

/* Thin line between ban phase 1 (3 bans) and phase 2 (2 bans) */
.bans-sep {
  width: 1px;
  height: 30px;
  background: rgba(200, 160, 80, 0.2);
  flex-shrink: 0;
  margin: 0 6px;
}

/* ─── 2. Timer bar (8px) — halves shrink from edges toward center ──────── */
.timer-bar-track {
  height: 8px;
  flex-shrink: 0;
  background: rgba(200, 160, 80, 0.08);
  position: relative;
  overflow: hidden;
}

.timer-bar-half {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
  transition: transform 0.5s linear;
}

.timer-bar-half--left {
  left: 0;
  transform-origin: right center;
  background: linear-gradient(to right, #5a1e06, #c0602a, #e8963a);
}

.timer-bar-half--right {
  right: 0;
  transform-origin: left center;
  background: linear-gradient(to left, #5a1e06, #c0602a, #e8963a);
}

.timer-bar-half--urgent {
  background: #c03030 !important;
  animation: bar-urgent 0.4s ease-in-out infinite alternate;
}

@keyframes bar-urgent {
  from { opacity: 1; }
  to   { opacity: 0.5; }
}

/* ─── 3. Picks row (280px fixní výška, taller broadcast look) ─────────── */
/* Width: 5×150 + 150 + 120 + 150 + 5×150 = 1920px */
.picks-row {
  height: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* ── Center league logo slot — 120px ── */
.logo-slot {
  width: 120px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-bottom: 8px;
  background: rgba(4, 3, 8, 0.97);
  border-left:  1px solid rgba(200, 160, 80, 0.1);
  border-right: 1px solid rgba(200, 160, 80, 0.1);
}

.logo-img {
  width: 100%;
  flex: 1;
  min-height: 0;
  object-fit: contain;
}

.logo-patch {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 17px;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  flex-shrink: 0;
}

/* ── Team info slots — 150px ── */
.team-slot {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 16px 8px 8px;
}

/* Blue: team color glows from center, fades quickly to dark */
.team-slot--blue {
  background: radial-gradient(circle at center, #fbbc23 0%, rgba(6, 4, 10, 0.97) 45%);
}

/* Red: same with red */
.team-slot--red {
  background: radial-gradient(circle at center, #ef4444 0%, rgba(6, 4, 10, 0.97) 45%);
}

/* Team logo image */
.ts-logo {
  width: 120px;
  height: 120px;
  object-fit: contain;
  flex-shrink: 0;
}

/* Fallback when no iconUri */
.ts-logo-placeholder {
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 34px;
  color: rgba(240, 232, 216, 0.35);
  flex-shrink: 0;
}

/* Team name — matches .pick-player style */
.ts-name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 134px;
  text-align: center;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

/* Score dots */
.ts-score {
  display: flex;
  gap: 5px;
}

/* Season record text — BO1 */
.ts-season-score {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  letter-spacing: 0.06em;
}
.ts-season-score--blue { color: #fbbc23; text-shadow: 0 0 8px rgba(251, 188, 35, 0.6); }
.ts-season-score--red  { color: #ef4444; text-shadow: 0 0 8px rgba(239, 68, 68,  0.6); }

/* Match win dots — BO3 / BO5 */
.ts-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(18, 12, 6, 0.9);
}

.ts-dot--blue-win {
  background: #fbbc23;
  border-color: #fbbc23;
  box-shadow: 0 0 6px rgba(251, 188, 35, 0.75);
}

.ts-dot--red-win {
  background: #ef4444;
  border-color: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.75);
}
</style>
