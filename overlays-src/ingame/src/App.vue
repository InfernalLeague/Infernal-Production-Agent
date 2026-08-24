<script setup lang="ts">
import Scoreboard      from '@/components/Scoreboard/Scoreboard.vue'
import BottomPanel     from '@/components/BottomPanel/BottomPanel.vue'
import ObjectiveTimers from '@/components/ObjectiveTimer/ObjectiveTimers.vue'
import ConnectionStatus from '@/components/ConnectionStatus/ConnectionStatus.vue'
import LFrame          from '@/components/LFrame/LFrame.vue'
import MinimapFrame    from '@/components/MinimapFrame/MinimapFrame.vue'
import PatchPanel      from '@/components/PatchPanel/PatchPanel.vue'
import SmiteReaction   from '@/components/SmiteReaction/SmiteReaction.vue'
import DevMock from '@/components/DevMock/DevMock.vue'

// Mock režim: buď dev build (VITE_MOCK=false ho vypne), NEBO ?mock v URL
// (funguje i v produkčním buildu — náhled v dashboardu bez hry / LeagueBroadcastu).
const DEV = new URLSearchParams(location.search).has('mock')
  || (import.meta.env.DEV && import.meta.env.VITE_MOCK !== 'false')
</script>

<template>
  <DevMock v-if="DEV">
    <div class="overlay overlay--dev">
      <LFrame />
      <Scoreboard />
      <BottomPanel />
      <ObjectiveTimers />
      <PatchPanel />
      <MinimapFrame />
      <SmiteReaction />
      <ConnectionStatus />
    </div>
  </DevMock>

  <div v-else class="overlay">
    <LFrame />
    <Scoreboard />
    <BottomPanel />
    <ObjectiveTimers />
    <PatchPanel />
    <MinimapFrame />
    <SmiteReaction />
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
  background: #1a1208 url('/dev-bg.png') center / cover no-repeat;
}
</style>
