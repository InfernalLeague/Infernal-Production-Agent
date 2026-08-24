<script setup lang="ts">
import { computed } from 'vue'
import { useClient } from '@/client'
import { useIngameSelector } from '@/composables/useIngame'
import { useLiveConfig } from '@/composables/useLiveConfig'

const client = useClient()
// Convert a BlueBottle cache-relative path to a full http://localhost:58869/cache/… URL.
// Absolute URLs (starting with "http") are passed through unchanged.
const resolveUrl = (path?: string | null): string =>
  path ? client.getCacheUrl(path) : ''

const scoreboard = useIngameSelector((s) => s.gameData?.scoreboard ?? null, null)
const gameTime   = useIngameSelector((s) => s.gameData?.gameTime ?? 0, 0)

// Auto-shrink team names: pokud se nevejdou do max-width (viz .team__name v CSS),
// zmenší font-size dolů po 1px, dokud se neschovají. Když se vejdou, zůstane max.
// Panel díky tomu nikdy nemění šířku podle délky jména.
//
// POZOR: Rajdhani se načítá z Google Fonts asynchronně (display=swap). Kdybychom
// měřili scrollWidth před jeho načtením, brali bychom šířku fallback fontu,
// který je užší → nezmenšíme font a po pozdějším swapu na Rajdhani text přeteče.
// Řešení: po každém volání znovu ověřit po `document.fonts.ready`.
function fitTeamName(el: HTMLElement, opts?: { min?: number; max?: number }): void {
  const min = opts?.min ?? 18
  const max = opts?.max ?? 34
  const shrink = (): void => {
    el.style.fontSize = max + 'px'
    let fs = max
    let guard = 40
    while (el.scrollWidth > el.clientWidth && fs > min && guard-- > 0) {
      fs -= 1
      el.style.fontSize = fs + 'px'
    }
  }
  shrink()
  // Přeměřit po načtení custom fontu — a pro jistotu ještě jednou v dalším frame
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    document.fonts.ready.then(() => { shrink(); requestAnimationFrame(shrink) })
  }
}
const vFitName = {
  mounted(el: HTMLElement) { fitTeamName(el) },
  updated(el: HTMLElement) { fitTeamName(el) },
}

const blue = computed(() => scoreboard.value?.teams?.[0] ?? null)
const red  = computed(() => scoreboard.value?.teams?.[1] ?? null)

// BestOf1 = regular season → show totalScore text e.g. "5–2"
// BestOf3/5 = playoff series → show win-dot circles (2 or 3 per team)
const bestOf     = computed(() => scoreboard.value?.bestOf ?? 1)
const isPlayoff  = computed(() => (bestOf.value as number) > 1)
// Number of wins needed (= circles shown): ceil(bestOf/2)  → Bo3=2, Bo5=3
const winsNeeded = computed(() => Math.ceil((bestOf.value as number) / 2))

// Bo1 (regular season) W-L text is driven by Supabase via live_config: the
// operator sets the two team_ids per broadcast on the admin "Live game" page
// and matches are counted from public.matches. BlueBottle's totalScore isn't
// used here because it needs manual per-broadcast setup.
// Bo3/Bo5 series dots keep reading BlueBottle's seriesScore inline — series
// state is per-draft and the DB has no concept of "current series".
const { blueRecord: liveBlueRecord, redRecord: liveRedRecord } = useLiveConfig()

// Real BlueBottle uses 'gold'; dev mock also provides 'totalGold' for compat.
function teamGold(team: any): number {
  return team?.gold ?? team?.totalGold ?? 0
}

// Gold diff: positive = blue ahead
const blueGoldDiff = computed(() => teamGold(blue.value) - teamGold(red.value))

// ─── Baron Powerplay ────────────────────────────────────────────────
// baronPowerPlay is present (truthy) while the buff is active.
// timeEnd = absolute game time when buff expires; gold = BlueBottle-tracked advantage.
const blueBaronRemaining = computed(() =>
  Math.max(0, Math.floor((blue.value?.baronPowerPlay?.timeEnd ?? 0) - gameTime.value))
)
const redBaronRemaining = computed(() =>
  Math.max(0, Math.floor((red.value?.baronPowerPlay?.timeEnd ?? 0) - gameTime.value))
)
const blueBaronGoldGained = computed(() => blue.value?.baronPowerPlay?.gold ?? 0)
const redBaronGoldGained  = computed(() => red.value?.baronPowerPlay?.gold  ?? 0)

// ─── Elder Powerplay ────────────────────────────────────────────────
// dragonPowerPlay is present (truthy) while the elder buff is active.
const blueElderRemaining = computed(() =>
  Math.max(0, Math.floor((blue.value?.dragonPowerPlay?.timeEnd ?? 0) - gameTime.value))
)
const redElderRemaining = computed(() =>
  Math.max(0, Math.floor((red.value?.dragonPowerPlay?.timeEnd ?? 0) - gameTime.value))
)

// ─── Role Quest Progress ─────────────────────────────────────────────
// Real BlueBottle delivers this via sideInfoPage (type=64=RoleQuest).
// sideInfoPage.players contains all 10 players; team 1=Order/blue, team 2=Chaos/red.
// Player order within each team: [top, jungle, mid, adc, support].
interface RoleQuest { role: string; progress: number }
const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const

const sideInfoPage = useIngameSelector(
  (s) => {
    const page = s.gameData?.sideInfoPage
    return page?.type === 64 ? page : null  // 64 = IngameSideInfoPageType.RoleQuest
  },
  null as any,
)

function mapRoleQuests(teamId: 1 | 2): RoleQuest[] {
  const players = sideInfoPage.value?.players ?? []
  const teamPlayers = players.filter((p: any) => p.team === teamId)
  return teamPlayers
    .map((p: any, i: number) => {
      const cur = p.curValue ?? p.displayValue ?? 0
      const max = p.maxValue ?? 100
      return { role: ROLES[i] ?? 'top', progress: max > 0 ? Math.round((cur / max) * 100) : 0 }
    })
    .filter((q: RoleQuest) => q.progress < 100)
}

// Filter out completed (progress === 100) — those fade out via TransitionGroup
const blueActiveRQ = computed(() => mapRoleQuests(1))
const redActiveRQ  = computed(() => mapRoleQuests(2))
// Red side is mirrored: Support closest to obj row, so display in reverse
const redActiveRQDisplay = computed(() => [...redActiveRQ.value].reverse())

// Circumference for r=11 circle (28×28 viewBox)
const RQ_CIRC = 69.12

function rqDash(progress: number) {
  return `${((progress / 100) * RQ_CIRC).toFixed(2)} ${RQ_CIRC}`
}

// Maps every known BlueBottle / Riot dragon name variant to our icon filename base.
// Riot renamed classic elements in Season 15 (Infernal→Fire, Ocean→Water,
// Cloud/Wind→Air, Mountain→Earth) but the game / BlueBottle may still send old names.
const DRAGON_ICON: Record<string, string> = {
  // current Season 15 names (BlueBottle may already send these)
  fire: 'fire', water: 'water', air: 'air', earth: 'earth',
  // pre-S15 Riot names (still seen in some BlueBottle versions)
  infernal: 'fire', ocean: 'water', cloud: 'air', wind: 'air', mountain: 'earth',
  // unchanged across all seasons
  hextech: 'hextech', chemtech: 'chemtech',
}
function dragonIcon(dragon: string): string {
  return DRAGON_ICON[dragon.toLowerCase()] ?? dragon.toLowerCase()
}

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
function kg(g: number) {
  return (Math.round(Math.abs(g) / 100) / 10).toFixed(1) + 'k'
}
function fmtDiff(diff: number): string {
  return (diff >= 0 ? '+' : '−') + kg(Math.abs(diff))
}
</script>

<template>
  <Transition name="sb">
    <div v-if="scoreboard" class="sb-wrap">

      <!-- ─── LEFT SIDE BUFFS (Baron + Elder, stacked) ───────────── -->
      <div class="buff-stack buff-stack--y">
        <Transition name="bp-y">
          <div v-if="blue?.baronPowerPlay" class="bp bp--y">
            <div class="bp__header">
              <div class="bp__icon"><img class="bp__baron-icon" src="https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/baron.png" alt="baron" /></div>
              <span class="bp__title">BARON POWERPLAY</span>
            </div>
            <div class="bp__stats">
              <span class="bp__gold">+{{ kg(blueBaronGoldGained) }}</span>
              <div class="bp__vsep" />
              <span class="bp__timer">{{ fmt(blueBaronRemaining) }}</span>
            </div>
          </div>
        </Transition>
        <Transition name="ep-y">
          <div v-if="blue?.dragonPowerPlay" class="ep ep--y">
            <div class="ep__header">
              <div class="ep__icon"><img class="ep__elder-icon" src="https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/dragon_elder.png" alt="elder" /></div>
              <span class="ep__title">ELDER BUFF</span>
            </div>
            <div class="ep__stats">
              <span class="ep__timer">{{ fmt(blueElderRemaining) }}</span>
            </div>
          </div>
        </Transition>
      </div>

      <!-- ─── RIGHT SIDE BUFFS (Baron + Elder, stacked) ───────────── -->
      <div class="buff-stack buff-stack--r">
        <Transition name="bp-r">
          <div v-if="red?.baronPowerPlay" class="bp bp--r">
            <div class="bp__header">
              <div class="bp__icon"><img class="bp__baron-icon" src="https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/baron.png" alt="baron" /></div>
              <span class="bp__title">BARON POWERPLAY</span>
            </div>
            <div class="bp__stats bp__stats--r">
              <span class="bp__timer">{{ fmt(redBaronRemaining) }}</span>
              <div class="bp__vsep" />
              <span class="bp__gold">+{{ kg(redBaronGoldGained) }}</span>
            </div>
          </div>
        </Transition>
        <Transition name="ep-r">
          <div v-if="red?.dragonPowerPlay" class="ep ep--r">
            <div class="ep__header">
              <div class="ep__icon"><img class="ep__elder-icon" src="https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/dragon_elder.png" alt="elder" /></div>
              <span class="ep__title">ELDER BUFF</span>
            </div>
            <div class="ep__stats">
              <span class="ep__timer">{{ fmt(redElderRemaining) }}</span>
            </div>
          </div>
        </Transition>
      </div>

      <!-- ─── CENTER MODULE ───────────────────────────────── -->
      <div class="cm">
        <div class="cm__cap" />
        <div class="cm__body">
          <div class="cm__ember" />
          <div class="score">
            <span class="score__n score__n--y">{{ blue?.kills ?? 0 }}</span>
            <div class="score__divider"><span class="score__sep">:</span></div>
            <span class="score__n score__n--r">{{ red?.kills ?? 0 }}</span>
          </div>
        </div>
        <div class="cm__time">{{ fmt(gameTime) }}</div>
      </div>

      <!-- ─── MAIN PANEL ──────────────────────────────────── -->
      <div class="panel">
        <div class="panel__topline" />

        <div class="panel__body">

          <!-- LEFT TEAM -->
          <div class="team team--y">

            <!-- Identity: badge + name + record -->
            <div class="team__id">
              <div class="badge badge--y">
                <div class="badge__ring" />
                <!-- Show team logo from BlueBottle cache; fall back to tag initial -->
                <img
                  v-if="resolveUrl(blue?.teamIconUrl)"
                  :src="resolveUrl(blue?.teamIconUrl)"
                  class="badge__logo"
                  :alt="blue?.teamTag"
                />
                <span v-else class="badge__letter">{{ (blue?.teamTag ?? 'A')[0]?.toUpperCase() }}</span>
              </div>
              <div class="team__meta">
                <span v-fit-name class="team__name">{{ blue?.teamName ?? 'TEAM A' }}</span>
                <!-- Bo1: text standings | Bo3/Bo5: win-dot circles -->
                <span v-if="!isPlayoff" class="team__record">
                  {{ liveBlueRecord.wins }}–{{ liveBlueRecord.losses }}
                </span>
                <div v-else class="team__wins">
                  <span
                    v-for="n in winsNeeded" :key="n"
                    class="win-dot win-dot--y"
                    :class="{ 'win-dot--on': n <= (blue?.seriesScore?.wins ?? 0) }"
                  />
                </div>
              </div>
            </div>

            <!-- Stats: towers → gold toward center -->
            <div class="team__stats">
              <div class="hstat">
                <img class="ic" src="/icons/tower-blue.png" alt="tower" />
                <span class="hstat__val">{{ blue?.towers ?? 0 }}</span>
              </div>
              <div class="hstat hstat--gold">
                <img class="ic" src="/icons/gold-blue.png" alt="gold" />
                <div class="gold-wrap">
                  <span class="hstat__val hstat__val--gold">{{ kg(teamGold(blue)) }}</span>
                  <span v-if="blueGoldDiff > 0" class="gold-diff diff--pos">
                    {{ fmtDiff(blueGoldDiff) }}
                  </span>
                </div>
              </div>
            </div>

          </div>

          <div class="panel__ph" />

          <!-- RIGHT TEAM (mirrored: gold → kills → towers toward edge) -->
          <div class="team team--r">

            <!-- Stats: gold → towers toward edge -->
            <div class="team__stats team__stats--r">
              <div class="hstat hstat--gold">
                <div class="gold-wrap gold-wrap--r">
                  <span class="hstat__val hstat__val--gold">{{ kg(teamGold(red)) }}</span>
                  <span v-if="blueGoldDiff < 0" class="gold-diff diff--neg">
                    {{ fmtDiff(-blueGoldDiff) }}
                  </span>
                </div>
                <img class="ic" src="/icons/gold-red.png" alt="gold" />
              </div>
              <div class="hstat">
                <span class="hstat__val">{{ red?.towers ?? 0 }}</span>
                <img class="ic" src="/icons/tower-red.png" alt="tower" />
              </div>
            </div>

            <!-- Identity: name toward center, logo on far right edge -->
            <div class="team__id team__id--r">
              <div class="team__meta team__meta--r">
                <span v-fit-name class="team__name">{{ red?.teamName ?? 'TEAM B' }}</span>
                <span v-if="!isPlayoff" class="team__record">
                  {{ liveRedRecord.wins }}–{{ liveRedRecord.losses }}
                </span>
                <div v-else class="team__wins">
                  <span
                    v-for="n in winsNeeded" :key="n"
                    class="win-dot win-dot--r"
                    :class="{ 'win-dot--on': n <= (red?.seriesScore?.wins ?? 0) }"
                  />
                </div>
              </div>
              <div class="badge badge--r">
                <div class="badge__ring" />
                <img
                  v-if="resolveUrl(red?.teamIconUrl)"
                  :src="resolveUrl(red?.teamIconUrl)"
                  class="badge__logo"
                  :alt="red?.teamTag"
                />
                <span v-else class="badge__letter">{{ (red?.teamTag ?? 'B')[0]?.toUpperCase() }}</span>
              </div>
            </div>

          </div>

        </div>

      </div>

      <!-- ─── OBJECTIVE ROW (outside panel, splits at center) ─────── -->
      <div class="obj-row">

        <!-- Role quests: blue side (left, anchored to obj row) -->
        <div class="rq-row rq-row--y">
          <TransitionGroup name="rq">
            <div v-for="quest in blueActiveRQ" :key="quest.role" class="rq-icon">
              <svg class="rq-svg" viewBox="0 0 28 28" fill="none">
                <!-- Track -->
                <circle cx="14" cy="14" r="11" stroke="rgba(255,255,255,0.10)" stroke-width="2.5"/>
                <!-- Progress arc (starts from 12 o'clock) -->
                <circle
                  cx="14" cy="14" r="11"
                  stroke="#fbbc23"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  :stroke-dasharray="rqDash(quest.progress)"
                  transform="rotate(-90 14 14)"
                />
              </svg>
              <img class="rq-img" :src="`/icons/role-${quest.role}.png`" :alt="quest.role" />
            </div>
          </TransitionGroup>
        </div>

        <!-- Left: ends at left edge of score box -->
        <div class="obj-team obj-team--y">
          <div class="obj-fixed">
            <Transition name="obj">
              <div v-if="(blue?.heralds ?? 0) > 0" class="obj-icon">
                <img class="obj-img" src="/icons/herald-blue.png" alt="herald" />
              </div>
            </Transition>
            <Transition name="obj">
              <div v-if="(blue?.grubs ?? 0) > 0" class="obj-icon obj-grubs-wrap">
                <img class="obj-img obj-img--sm" src="/icons/grubs-blue.png" alt="grubs" />
                <span class="obj-count">{{ blue?.grubs }}</span>
              </div>
            </Transition>
          </div>
          <div class="obj-dragons">
            <TransitionGroup name="obj">
              <div v-for="(dragon, i) in (blue?.dragons ?? []).filter(d => d !== 'Elder').slice(0, 4)" :key="'b-d-' + i" class="obj-icon">
                <img class="obj-img" :src="'/icons/dragon-' + dragonIcon(dragon) + '-blue.png'" :alt="dragon" />
              </div>
            </TransitionGroup>
          </div>
        </div>

        <!-- Center gap: transparent, time floats here from .cm -->
        <div class="obj-gap" />

        <!-- Right: starts at right edge of score box -->
        <div class="obj-team obj-team--r">
          <div class="obj-dragons">
            <TransitionGroup name="obj">
              <div v-for="(dragon, i) in (red?.dragons ?? []).filter(d => d !== 'Elder').slice(0, 4)" :key="'r-d-' + i" class="obj-icon">
                <img class="obj-img" :src="'/icons/dragon-' + dragonIcon(dragon) + '-red.png'" :alt="dragon" />
              </div>
            </TransitionGroup>
          </div>
          <div class="obj-fixed">
            <Transition name="obj">
              <div v-if="(red?.grubs ?? 0) > 0" class="obj-icon obj-grubs-wrap">
                <span class="obj-count">{{ red?.grubs }}</span>
                <img class="obj-img obj-img--sm" src="/icons/grubs-red.png" alt="grubs" />
              </div>
            </Transition>
            <Transition name="obj">
              <div v-if="(red?.heralds ?? 0) > 0" class="obj-icon">
                <img class="obj-img" src="/icons/herald-red.png" alt="herald" />
              </div>
            </Transition>
          </div>
        </div>

        <!-- Role quests: red side (right, anchored to obj row, mirrored order) -->
        <div class="rq-row rq-row--r">
          <TransitionGroup name="rq">
            <div v-for="quest in redActiveRQDisplay" :key="quest.role" class="rq-icon">
              <svg class="rq-svg" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="11" stroke="rgba(255,255,255,0.10)" stroke-width="2.5"/>
                <circle
                  cx="14" cy="14" r="11"
                  stroke="#ef4444"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  :stroke-dasharray="rqDash(quest.progress)"
                  transform="rotate(-90 14 14)"
                />
              </svg>
              <img class="rq-img" :src="`/icons/role-${quest.role}.png`" :alt="quest.role" />
            </div>
          </TransitionGroup>
        </div>

      </div>

    </div>
  </Transition>
</template>

<style scoped>
/* ─── Wrapper ───────────────────────────────────────────────────── */
.sb-wrap {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  width: 1160px;
}

/* ─── CENTER MODULE ─────────────────────────────────────────────── */
.cm {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  z-index: 20;
  filter: drop-shadow(0 4px 20px rgba(0, 0, 0, 0.85));
}

.cm__cap {
  height: 6px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(180, 80, 10, 0.6) 15%,
    rgba(249, 115, 22, 0.9) 35%,
    rgba(251, 191, 36, 0.95) 50%,
    rgba(249, 115, 22, 0.9) 65%,
    rgba(180, 80, 10, 0.6) 85%,
    transparent 100%
  );
  clip-path: polygon(16px 0%, calc(100% - 16px) 0%, 100% 100%, 0% 100%);
}

.cm__body {
  position: relative;
  background: linear-gradient(180deg, rgba(10, 5, 1, 0.92) 0%, rgba(5, 2, 0, 0.90) 100%);
  border-left: 1px solid rgba(249, 115, 22, 0.15);
  border-right: 1px solid rgba(249, 115, 22, 0.15);
  border-bottom: 1px solid rgba(249, 115, 22, 0.10);
  padding: 0 12px;
  min-height: 76px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cm__ember {
  position: absolute;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 110px;
  height: 36px;
  background: radial-gradient(ellipse at center, rgba(249, 115, 22, 0.07) 0%, transparent 65%);
  pointer-events: none;
}

.score {
  display: flex;
  align-items: center;
  line-height: 1;
}
.score__n {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 55px;
  line-height: 1;
  min-width: 36px;
  text-align: center;
}
.score__n--y {
  color: #fbbf24;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95), 0 0 14px rgba(251, 191, 36, 0.55);
}
.score__n--r {
  color: #ef4444;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95), 0 0 14px rgba(239, 68, 68, 0.55);
}
.score__divider {
  display: flex;
  align-items: center;
  padding: 0 4px;
}
.score__sep {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 22px;
  color: rgba(255, 255, 255, 0.90);
  line-height: 1;
}
/* ─── TIME (below score box, outside border) ─────────────────────── */
.cm__time {
  text-align: center;
  margin-top: 2px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 35px;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.90);
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.95);
  line-height: 1;
}

/* ─── MAIN PANEL ────────────────────────────────────────────────── */
.panel {
  position: relative;
  z-index: 10;
  width: 1100px;
  margin: 3px auto 0;
  background: rgba(9, 5, 2, 0.60);
  clip-path: polygon(
    10px 0%, calc(100% - 10px) 0%,
    100% 10px, 100% 100%,
    0% 100%, 0% 10px
  );
  border: 1px solid rgba(249, 115, 22, 0.08);
  filter: drop-shadow(0 6px 28px rgba(0, 0, 0, 0.70));
}

.panel__topline {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 4%,
    rgba(120, 50, 8, 0.5) 15%,
    rgba(249, 115, 22, 0.65) 30%,
    rgba(249, 115, 22, 0.65) 70%,
    rgba(120, 50, 8, 0.5) 85%,
    transparent 96%
  );
}

.panel__body {
  display: flex;
  align-items: stretch;
  height: 70px;
}

/* ─── TEAM SECTIONS ─────────────────────────────────────────────── */
.team {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 0;
  padding: 0 10px;
  overflow: hidden;
  position: relative;
}

.team--y {
  border-left: 2px solid rgba(251, 191, 36, 0.40);
  background: linear-gradient(90deg, rgba(251, 191, 36, 0.03) 0%, transparent 55%);
}
.team--y::after {
  content: '';
  position: absolute;
  right: 0; top: 0; bottom: 0; width: 12px;
  background: linear-gradient(90deg, transparent, rgba(9, 5, 2, 0.25));
  pointer-events: none;
}

.team--r {
  justify-content: flex-end;
  border-right: 2px solid rgba(239, 68, 68, 0.40);
  background: linear-gradient(270deg, rgba(239, 68, 68, 0.03) 0%, transparent 55%);
}
.team--r::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0; width: 12px;
  background: linear-gradient(270deg, transparent, rgba(9, 5, 2, 0.25));
  pointer-events: none;
}

.panel__ph {
  width: 160px;
  flex-shrink: 0;
}

/* ─── TEAM IDENTITY ─────────────────────────────────────────────── */
/* Intrinsic width, ale ohraničené — dohromady team__id + team__stats musí sedět
   do team.flex:1 (~450 px content area). Stats potřebují ~216 px na ikony a
   padding, takže team__id nesmí přerůst ~230 px. Jinak by stats (flex-shrink:1)
   začal scvrkat a jeho ikony by přetékaly vlevo (a `.team { overflow:hidden }`
   by je oříznulo — to je ten „posouvající se panel").
   Kratší jména roste-nikoli — team__id se přizpůsobí, statsy zůstávají v místě. */
.team__id {
  display: flex;
  align-items: center;
  align-self: center;
  gap: 7px;
  flex-shrink: 0;
  overflow: hidden;
  max-width: 230px;
}
/* Right team: [name] [logo] — logo stays at far-right edge, no reversal needed */
.team__id--r { flex-direction: row; }

.team__meta {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.team__meta--r { align-items: flex-end; }

/* ─── BADGE ─────────────────────────────────────────────────────── */
.badge {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}
.badge--y {
  background: linear-gradient(140deg, rgba(251, 191, 36, 0.18) 0%, rgba(180, 120, 10, 0.06) 100%);
  border: 1px solid rgba(251, 191, 36, 0.45);
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.12);
}
.badge--r {
  background: linear-gradient(140deg, rgba(239, 68, 68, 0.18) 0%, rgba(180, 30, 30, 0.06) 100%);
  border: 1px solid rgba(239, 68, 68, 0.45);
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.12);
}
.badge__ring {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.07);
}
.badge__letter {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
  text-transform: uppercase;
  position: relative;
  z-index: 1;
}
.badge--y .badge__letter { color: #fbbf24; }
.badge--r .badge__letter { color: #ef4444; }

/* Team logo image — sized to fit the badge circle */
.badge__logo {
  width: 34px;
  height: 34px;
  object-fit: contain;
  display: block;
  position: relative;
  z-index: 1;
  border-radius: 50%;
  /* Subtle brightness boost so logos pop against the dark badge bg */
  filter: brightness(1.08) drop-shadow(0 0 3px rgba(0,0,0,0.6));
}

/* ─── TEAM NAME / RECORD ────────────────────────────────────────── */
.team__name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 34px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.95);
  line-height: 1;
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.95);
  /* Pevný rozpočet šířky — team__id má max-width 230, badge zabere 42+7,
     zbývá 181 px na jméno. Při dlouhých jménech direktiva v-fit-name
     zmenší font-size, aby se text vešel do těch 181 px. */
  display: inline-block;
  max-width: 181px;
  white-space: nowrap;
  overflow: hidden;
}
.team__record {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 15px;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.82);
  text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}

/* ─── SERIES WIN DOTS (playoff Bo3 / Bo5) ──────────────────────── */
.team__wins {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 18px; /* matches .team__record line-height visually */
}

.win-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease;
}

/* Empty — dim ring, almost transparent fill */
.win-dot--y {
  background: rgba(251, 191, 36, 0.06);
  border: 1.5px solid rgba(251, 191, 36, 0.38);
}
.win-dot--r {
  background: rgba(239, 68, 68, 0.06);
  border: 1.5px solid rgba(239, 68, 68, 0.38);
}

/* Filled — vibrant solid + multi-layer glow */
.win-dot--y.win-dot--on {
  background: #fde047;
  border-color: #fde047;
  box-shadow:
    0 0 5px  rgba(253, 224, 71, 1.0),
    0 0 12px rgba(251, 191, 36, 0.80),
    0 0 24px rgba(251, 191, 36, 0.45);
}
.win-dot--r.win-dot--on {
  background: #ff5f5f;
  border-color: #ff5f5f;
  box-shadow:
    0 0 5px  rgba(255,  95,  95, 1.0),
    0 0 12px rgba(239,  68,  68, 0.80),
    0 0 24px rgba(239,  68,  68, 0.45);
}

/* ─── HORIZONTAL STATS ──────────────────────────────────────────── */
/* Stats block: fills remaining space, single horizontal line */
.team__stats {
  flex: 1;
  display: flex;
  align-items: center;
  align-self: center;           /* vertically centered in panel */
  justify-content: flex-end;   /* push stats toward center (left team) */
  gap: 28px;                   /* space between tower slot and gold slot */
  padding: 0 32px 0 8px;      /* right padding = gap toward center module */
}
.team__stats--r {
  justify-content: flex-start; /* push stats toward center (right team) */
  padding: 0 8px 0 32px;      /* left padding = gap toward center module */
}

/* Single stat: fixed-width slot, content centered */
.hstat {
  width: 74px;
  flex-shrink: 0;
  flex-grow: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;                    /* consistent icon ↔ number spacing */
}
/* Right-team: reverse icon/number order */
.hstat--rev {
  flex-direction: row-reverse;
}

/* Gold slot: wider to fit number + accommodate diff below */
.hstat--gold {
  width: 108px;
  /* gap inherited from .hstat (8px) */
}

/* Number value — large and dominant */
.hstat__val {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 35px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  letter-spacing: 0.02em;
}

/* Gold value — white, same weight as other stats */
.hstat__val--gold {
  color: rgba(255, 255, 255, 0.95);
  font-size: 35px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
}

/* Gold number wrapper — diff is absolutely positioned so it doesn't
   affect the vertical centering of the numbers row */
.gold-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
}
.gold-wrap--r { align-items: flex-end; }

/* Gold diff — absolute, hangs below gold number without shifting center */
.gold-diff {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 3px;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 15px;
  line-height: 1;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
}
.gold-wrap--r .gold-diff { left: auto; right: 0; }
.diff--pos { color: #fbbf24; }
.diff--neg { color: rgba(239, 68, 68, 0.85); }

/* Stat divider — sits between fixed-width hstat slots */
.sdiv {
  width: 1px;
  height: 24px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  margin: 0 2px;
}

/* ─── ICONS ─────────────────────────────────────────────────────── */
.ic {
  display: block;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  object-fit: contain;
}

/* ─── OBJECTIVE ROW ─────────────────────────────────────────────── */
.obj-row {
  display: flex;
  align-items: stretch;
  justify-content: center; /* compact boxes hug content, centered on score box */
  height: 30px;
}

/* Team panels — fixed width, never resizes with content */
.obj-team {
  display: flex;
  align-items: center;
  width: 250px;
  flex-shrink: 0;
  padding: 0 10px;
  gap: 6px;
  overflow: hidden;
  background: rgba(9, 5, 2, 0.60);
  border-top: 1px solid rgba(249, 115, 22, 0.06);
}
.obj-team--y { border-left: 2px solid rgba(251, 191, 36, 0.40); }
.obj-team--r { border-right: 2px solid rgba(239, 68, 68, 0.40); }

/* Center gap — transparent, matches score box width so panels start at its edges */
.obj-gap {
  width: 160px;
  flex-shrink: 0;
  /* no background */
}

/* Fixed block: herald + grubs anchored to outer edge */
.obj-fixed {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* Dragons block: auto-sized, no fill */
.obj-dragons {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* Blue: dragons anchor at center edge, fill leftward; fixed block stays at outer edge */
.obj-team--y .obj-dragons { margin-left: auto; flex-direction: row-reverse; }
/* Red: fixed block anchored to outer (right) edge, dragons stay at center edge */
.obj-team--r .obj-fixed { margin-left: auto; }

/* Generic icon wrapper */
.obj-icon {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* Objective icons */
.obj-img {
  display: block;
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}
.obj-img--sm {
  width: 20px;
  height: 20px;
}

/* Void Grubs: icon + count */
.obj-grubs-wrap { gap: 4px; }
.obj-count {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.90);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
}

/* Objective appear/disappear */
.obj-enter-active { transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); }
.obj-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; position: absolute; }
.obj-enter-from   { opacity: 0; transform: translateY(-6px); }
.obj-leave-to     { opacity: 0; transform: translateY(-6px); }
.obj-move         { transition: transform 0.3s ease; }

/* ─── BUFF STACK WRAPPERS ───────────────────────────────────────── */
.buff-stack {
  position: absolute;
  top: 3px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 15;
}
.buff-stack--y {
  right: calc(100% - 30px); /* panel left edge = (sb-wrap 1160 - panel 1100) / 2 = 30px inset */
  align-items: flex-end;
}
.buff-stack--r {
  left: calc(100% - 30px); /* panel right edge */
  align-items: flex-start;
}

/* ─── BARON POWERPLAY MODULE ────────────────────────────────────── */
.bp {
  display: flex;
  flex-direction: column;
  min-width: 210px;
  height: 73px;     /* border-box: matches panel rendered height (1px topline + 70px body + 2px border) */
  overflow: hidden;
  background: rgba(5, 2, 12, 0.92);
  border: 1px solid rgba(167, 139, 250, 0.18);
  filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.88));
}

/* Left team — yellow accent left border */
.bp--y {
  border-left: 3px solid rgba(251, 191, 36, 0.70);
  clip-path: polygon(0% 0%, calc(100% - 10px) 0%, 100% 10px, 100% 100%, 0% 100%);
}
/* Right team — red accent right border */
.bp--r {
  border-right: 3px solid rgba(239, 68, 68, 0.70);
  clip-path: polygon(10px 0%, 100% 0%, 100% 100%, 0% 100%, 0% 10px);
}

/* ── Header ─────────────────────────────────────── */
.bp__header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 5px 12px 4px;
  flex-shrink: 0;
  background: linear-gradient(90deg, rgba(46,16,101,0.45), rgba(20,8,50,0.15));
  border-bottom: 1px solid rgba(167, 139, 250, 0.12);
}

/* "BARON POWERPLAY" label */
.bp__title {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: rgba(192, 132, 252, 0.95);
  text-shadow: 0 0 14px rgba(192, 132, 252, 0.35);
  white-space: nowrap;
}

/* Baron icon */
.bp__icon { flex-shrink: 0; }
.bp__baron-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  filter: drop-shadow(0 0 6px rgba(124, 58, 237, 0.80)) drop-shadow(0 0 14px rgba(124, 58, 237, 0.35));
}

/* ── Stats row ──────────────────────────────────── */
.bp__stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 0 18px;
  flex: 1;
}
.bp__stats--r { flex-direction: row-reverse; }

.bp__gold {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 26px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.9);
  letter-spacing: 0.02em;
}

.bp__vsep {
  width: 1px;
  height: 22px;
  background: rgba(167, 139, 250, 0.22);
  flex-shrink: 0;
}

.bp__timer {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 30px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.9);
  letter-spacing: 0.06em;
}

/* ── Transitions ─────────────────────────────────── */
.bp-y-enter-active { transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease; }
.bp-y-leave-active { transition: transform 0.35s ease, opacity 0.25s ease; }
.bp-y-enter-from, .bp-y-leave-to { transform: translateX(-115%); opacity: 0; }

.bp-r-enter-active { transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease; }
.bp-r-leave-active { transition: transform 0.35s ease, opacity 0.25s ease; }
.bp-r-enter-from, .bp-r-leave-to { transform: translateX(115%); opacity: 0; }

/* ─── ELDER BUFF MODULE ──────────────────────────────────────────── */
.ep {
  display: flex;
  flex-direction: column;
  min-width: 210px;
  height: 73px;     /* border-box: matches panel rendered height (1px topline + 70px body + 2px border) */
  overflow: hidden;
  background: rgba(2, 14, 9, 0.92);
  border: 1px solid rgba(21, 244, 180, 0.18);
  filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.88));
}

/* Left team — yellow accent left border */
.ep--y {
  border-left: 3px solid rgba(251, 191, 36, 0.70);
  clip-path: polygon(0% 0%, calc(100% - 10px) 0%, 100% 10px, 100% 100%, 0% 100%);
}
/* Right team — red accent right border */
.ep--r {
  border-right: 3px solid rgba(239, 68, 68, 0.70);
  clip-path: polygon(10px 0%, 100% 0%, 100% 100%, 0% 100%, 0% 10px);
}

.ep__header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 5px 12px 4px;
  flex-shrink: 0;
  background: linear-gradient(90deg, rgba(4, 58, 38, 0.60), rgba(2, 28, 18, 0.20));
  border-bottom: 1px solid rgba(21, 244, 180, 0.15);
}

.ep__title {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #15f4b4;
  text-shadow: 0 0 14px rgba(21, 244, 180, 0.40);
  white-space: nowrap;
}

.ep__icon { flex-shrink: 0; }
.ep__elder-icon {
  width: 28px;
  height: 28px;
  object-fit: contain;
  filter: drop-shadow(0 0 6px rgba(21, 244, 180, 0.75)) drop-shadow(0 0 14px rgba(21, 244, 180, 0.30));
}

/* Timer panel — darker shade of #15f4b4 */
.ep__stats {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 18px;
  flex: 1;
  background: rgba(4, 44, 29, 0.75);
}

.ep__timer {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 30px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 5px rgba(0, 0, 0, 0.9);
  letter-spacing: 0.06em;
}

.ep-y-enter-active { transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease; }
.ep-y-leave-active { transition: transform 0.35s ease, opacity 0.25s ease; }
.ep-y-enter-from, .ep-y-leave-to { transform: translateX(-115%); opacity: 0; }

.ep-r-enter-active { transition: transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease; }
.ep-r-leave-active { transition: transform 0.35s ease, opacity 0.25s ease; }
.ep-r-enter-from, .ep-r-leave-to { transform: translateX(115%); opacity: 0; }

/* ─── ROLE QUEST ROW ────────────────────────────────────────────── */
.rq-row {
  position: relative;        /* anchor for leaving-absolute elements */
  display: flex;
  align-items: center;
  gap: 5px;
  width: 170px;              /* fixed: 5×28px icons + 4×5px gaps + breathing */
  flex-shrink: 0;
  padding: 0 6px;
  height: 100%;
}

/* Blue: icons anchor to the RIGHT (toward obj row).
   When one leaves, remaining shift right. */
.rq-row--y { justify-content: flex-end; }

/* Red: icons anchor to the LEFT (toward obj row).
   When one leaves, remaining shift left. */
.rq-row--r { justify-content: flex-start; }

/* Single role icon wrapper */
.rq-icon {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* SVG ring — fills the icon slot */
.rq-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* Role image — centered inside the ring */
.rq-img {
  position: relative;
  z-index: 1;
  width: 14px;
  height: 14px;
  object-fit: contain;
  filter: brightness(1) saturate(0.75) contrast(0.9);
}

/* ── Appear / disappear ──────────────────────────── */
.rq-enter-active {
  transition: opacity 0.35s ease, transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.rq-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
  position: absolute;        /* leave flow so siblings can shift smoothly */
}
.rq-enter-from { opacity: 0; transform: scale(0.4); }
.rq-leave-to   { opacity: 0; transform: scale(0.4); }
.rq-move       { transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }

/* ─── SCOREBOARD TRANSITION ─────────────────────────────────────── */
.sb-enter-active { transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease; }
.sb-leave-active { transition: transform 0.75s cubic-bezier(0.55, 0, 1, 0.45), opacity 0.3s ease; }
.sb-enter-from, .sb-leave-to { transform: translateY(-120%); opacity: 0; }
</style>
