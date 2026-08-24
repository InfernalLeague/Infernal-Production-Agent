<script setup lang="ts">
import { usePreGameConnected } from '@/composables/useChampSelect'

const connected = usePreGameConnected()
</script>

<template>
  <Transition name="fade">
    <div v-if="!connected" class="status">
      <span class="status__dot" />
      Connecting to LeagueBroadcast…
    </div>
  </Transition>
</template>

<style scoped>
.status {
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(8, 6, 12, 0.9);
  border: 1px solid rgba(232, 150, 58, 0.2);
  border-radius: 4px;
  font-size: 12px;
  color: rgba(240, 232, 216, 0.5);
  backdrop-filter: blur(4px);
}

.status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e8963a;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
</style>
