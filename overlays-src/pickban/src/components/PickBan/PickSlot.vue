<script setup lang="ts">
interface Props {
  player: string
  championName?: string
  loadingImgUrl?: string
  isActive?: boolean
  side: 'blue' | 'red'
  role?: string    // top | jungle | mid | adc | support
  delay?: number   // entrance animation delay in seconds (staggered cascade)
}

withDefaults(defineProps<Props>(), {
  isActive: false,
  delay: 0,
})
</script>

<template>
  <div
    class="pick-card"
    :class="[`pick-card--${side}`, { 'pick-card--active': isActive, 'pick-card--empty': !loadingImgUrl }]"
    :style="{ animationDelay: `${delay}s` }"
  >
    <img v-if="loadingImgUrl" :src="loadingImgUrl" :alt="championName" class="pick-art" />
    <div class="pick-gradient" />
    <div class="pick-info">
      <img v-if="role" :src="`/icons/role-${role}.png`" :alt="role" class="pick-role" />
      <span class="pick-player">{{ player || '·' }}</span>
    </div>
    <div v-if="isActive" class="pick-active-glow" />
  </div>
</template>

<style scoped>
/* 150 × 280 px pick card — taller broadcast layout */
.pick-card {
  width: 150px;
  height: 280px;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(200, 160, 80, 0.08);
  transition: border-color 0.2s;
}

/* ── Entrance: each card slides out from the center toward its edge ──────── */
.pick-card--blue { animation: card-in-blue 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
.pick-card--red  { animation: card-in-red  0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }

/* Blue cards sit left of center → emerge from the right (center) sliding left */
@keyframes card-in-blue {
  from { transform: translateX(46px);  opacity: 0; }
  to   { transform: translateX(0);     opacity: 1; }
}

/* Red cards sit right of center → emerge from the left (center) sliding right */
@keyframes card-in-red {
  from { transform: translateX(-46px); opacity: 0; }
  to   { transform: translateX(0);     opacity: 1; }
}

.pick-card--empty {
  background: rgba(10, 7, 14, 0.9);
}

.pick-card--blue.pick-card--active {
  border-color: rgba(251, 188, 35, 0.65);
}

.pick-card--red.pick-card--active {
  border-color: rgba(239, 68, 68, 0.65);
}

/* Loading art: 308×560 portrait, cropped to 150×192, show upper body */
.pick-art {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 15%;
}

.pick-gradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(6, 4, 10, 0.92) 0%, rgba(6, 4, 10, 0.15) 45%, transparent 68%);
}

.pick-info {
  position: absolute;
  bottom: 10px;
  left: 0;
  right: 0;
  text-align: center;
  padding: 0 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.pick-role {
  width: 24px;
  height: 24px;
  object-fit: contain;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.9));
  opacity: 0.92;
}

.pick-player {
  display: block;
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 18px;
  color: #ffffff;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-active-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  animation: glow-pulse 0.7s ease-in-out infinite alternate;
}

.pick-card--blue .pick-active-glow {
  border-top: 2px solid #fbbc23;
  box-shadow: inset 0 6px 20px rgba(251, 188, 35, 0.3);
}

.pick-card--red .pick-active-glow {
  border-top: 2px solid #ef4444;
  box-shadow: inset 0 6px 20px rgba(239, 68, 68, 0.3);
}

@keyframes glow-pulse {
  from { opacity: 0.6; }
  to   { opacity: 1; }
}
</style>
