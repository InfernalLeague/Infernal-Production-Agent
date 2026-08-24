<script setup lang="ts">
import { useIngameConnected } from '@/composables/useIngame'

const connected = useIngameConnected()
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
  background: rgba(8, 10, 16, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(4px);
}

.status__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to       { opacity: 0; }
</style>
