<script setup lang="ts">
interface Props {
  imgUrl?: string
  name?: string
  isActive?: boolean
  minimal?: boolean   // borderless floating style for bans row
}

withDefaults(defineProps<Props>(), {
  isActive: false,
  minimal: false,
})
</script>

<template>
  <div
    class="ban-slot"
    :class="{ 'ban-slot--active': isActive, 'ban-slot--filled': !!imgUrl, 'ban-slot--minimal': minimal }"
  >
    <img v-if="imgUrl" :src="imgUrl" :alt="name" class="ban-icon" />
    <div v-else class="ban-empty">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="rgba(200,160,80,0.2)" stroke-width="1.5" />
      </svg>
    </div>
    <div v-if="imgUrl && !minimal" class="ban-overlay" />
  </div>
</template>

<style scoped>
.ban-slot {
  width: 48px;
  height: 48px;
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid rgba(200, 160, 80, 0.18);
  background: rgba(10, 8, 14, 0.8);
  transition: border-color 0.2s, box-shadow 0.2s;
}

/* Minimal = no border, no bg, just the icon floating */
.ban-slot--minimal {
  border: none;
  background: transparent;
}

.ban-slot--active {
  border-color: #e8963a;
  animation: ban-pulse 0.75s ease-in-out infinite alternate;
}

@keyframes ban-pulse {
  from { box-shadow: 0 0 6px rgba(232, 150, 58, 0.4); }
  to   { box-shadow: 0 0 14px rgba(232, 150, 58, 0.75); }
}

.ban-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(0.75) brightness(0.8);
}

/* Filled icon with no border: sharpen look slightly */
.ban-slot--minimal .ban-icon {
  filter: saturate(0.85) brightness(0.85);
  border-radius: 2px;
}

.ban-overlay {
  position: absolute;
  inset: 0;
  background: rgba(4, 2, 8, 0.4);
}

.ban-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
