<script setup lang="ts">
import PickBanScreen   from '@/components/PickBan/PickBanScreen.vue'
import ConnectionStatus from '@/components/ConnectionStatus/ConnectionStatus.vue'
import DevMock         from '@/components/DevMock/DevMock.vue'

// VITE_MOCK=false npm run dev  → real data (connect to LeagueBroadcast)
const DEV = import.meta.env.DEV && import.meta.env.VITE_MOCK !== 'false'
</script>

<template>
  <DevMock v-if="DEV">
    <div class="overlay overlay--dev">
      <PickBanScreen />
      <ConnectionStatus />
    </div>
  </DevMock>

  <div v-else class="overlay">
    <PickBanScreen />
    <ConnectionStatus />
  </div>
</template>

<style scoped>
.overlay {
  width: 1920px;
  height: 1080px;
  position: relative;
  overflow: hidden;
}

.overlay--dev {
  background: #0c0910;
}
</style>
