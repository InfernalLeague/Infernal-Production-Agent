<script setup lang="ts">
import PickBanScreen   from '@/components/PickBan/PickBanScreen.vue'
import ConnectionStatus from '@/components/ConnectionStatus/ConnectionStatus.vue'
import DevMock         from '@/components/DevMock/DevMock.vue'

// Mock režim: dev build (VITE_MOCK=false ho vypne), NEBO ?mock v URL
// (funguje i v produkčním buildu — náhled bez LeagueBroadcastu).
const DEV = new URLSearchParams(location.search).has('mock')
  || (import.meta.env.DEV && import.meta.env.VITE_MOCK !== 'false')
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
