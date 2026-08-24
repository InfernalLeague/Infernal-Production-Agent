<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  phaseName: number
  phaseDuration: number
  timeRemaining: number
  blueTag: string
  blueWins: number
  redTag: string
  redWins: number
  bestOf: number
  patch?: string
}

const props = defineProps<Props>()

const phaseLabel = computed(() => {
  switch (props.phaseName) {
    case 1: return 'BAN 1'
    case 2: return 'BAN 2'
    case 3: return 'PICK 1'
    case 4: return 'PICK 2'
    case 5: return 'DONE'
    default: return 'DRAFT'
  }
})

const timerDisplay = computed(() =>
  Math.max(0, Math.ceil(props.timeRemaining)).toString().padStart(2, '0'),
)

const timerProgress = computed(() =>
  props.phaseDuration > 0 ? props.timeRemaining / props.phaseDuration : 1,
)

const isUrgent   = computed(() => props.timeRemaining > 0 && props.timeRemaining <= 5)
const isBanPhase = computed(() => props.phaseName === 1 || props.phaseName === 2)
const maxWins    = computed(() => Math.ceil(props.bestOf / 2))
</script>

<template>
  <div class="center">

    <!-- Blue side -->
    <div class="side side--blue">
      <div class="side__tag">{{ blueTag }}</div>
      <div class="side__dots">
        <div
          v-for="i in maxWins"
          :key="i"
          class="dot"
          :class="i <= blueWins ? 'dot--win' : 'dot--empty'"
        />
      </div>
    </div>

    <!-- Timer + phase -->
    <div class="timer-block">
      <div class="phase-label" :class="isBanPhase && 'phase-label--ban'">
        {{ phaseLabel }}
      </div>
      <div class="timer" :class="isUrgent && 'timer--urgent'">
        {{ timerDisplay }}
      </div>
      <div class="progress-bar">
        <div
          class="progress-bar__fill"
          :class="isUrgent && 'progress-bar__fill--urgent'"
          :style="{ width: `${timerProgress * 100}%` }"
        />
      </div>
    </div>

    <!-- Red side -->
    <div class="side side--red">
      <div class="side__dots">
        <div
          v-for="i in maxWins"
          :key="i"
          class="dot"
          :class="i <= redWins ? 'dot--win' : 'dot--empty'"
        />
      </div>
      <div class="side__tag">{{ redTag }}</div>
    </div>

    <!-- Patch at very bottom -->
    <div v-if="patch" class="patch-label">{{ patch }}</div>
  </div>
</template>

<style scoped>
.center {
  width: 200px;
  height: 230px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  position: relative;
  background:
    radial-gradient(ellipse 80% 60% at 50% 50%, rgba(192, 96, 42, 0.1) 0%, transparent 70%),
    rgba(6, 4, 10, 0.96);
  border-left:  1px solid rgba(200, 160, 80, 0.12);
  border-right: 1px solid rgba(200, 160, 80, 0.12);
}

/* ── Side blocks ─────────────────────────────────── */
.side {
  display: flex;
  align-items: center;
  gap: 8px;
}

.side__tag {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 18px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.side--blue .side__tag { color: #8ab8e8; }
.side--red  .side__tag { color: #e88a8a; }

.side__dots {
  display: flex;
  gap: 5px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(200, 160, 80, 0.3);
}

.dot--win {
  background: #e8963a;
  border-color: #e8963a;
  box-shadow: 0 0 5px rgba(232, 150, 58, 0.55);
}

.dot--empty {
  background: rgba(18, 12, 6, 0.9);
}

/* ── Timer block ─────────────────────────────────── */
.timer-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.phase-label {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: 10px;
  color: rgba(200, 160, 80, 0.65);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.phase-label--ban {
  color: rgba(212, 96, 96, 0.8);
}

.timer {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 52px;
  color: #f0e8d8;
  line-height: 1;
  min-width: 70px;
  text-align: center;
  transition: color 0.2s;
}

.timer--urgent {
  color: #d44040;
  animation: urgent 0.45s ease-in-out infinite alternate;
}

@keyframes urgent {
  from { opacity: 1; }
  to   { opacity: 0.55; }
}

.progress-bar {
  width: 120px;
  height: 2px;
  background: rgba(200, 160, 80, 0.12);
  overflow: hidden;
}

.progress-bar__fill {
  height: 100%;
  background: linear-gradient(to right, #c0602a, #e8963a);
  transition: width 0.5s linear;
}

.progress-bar__fill--urgent {
  background: #d44040;
}

/* ── Patch ───────────────────────────────────────── */
.patch-label {
  position: absolute;
  bottom: 6px;
  font-size: 9px;
  color: rgba(138, 122, 106, 0.3);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
</style>
