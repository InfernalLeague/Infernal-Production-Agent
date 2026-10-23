<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useIsInGame } from '@/composables/useIngame'

// ── Žhavá linka přes spodní pruh ────────────────────────────────────────────
// Po horní lince spodního pruhu (L-Frame, hráči, panel u minimapy, minimapa)
// jednou za půl minuty přeběhne ohnivý záblesk zleva doprava. Jen během hry;
// animuje se transform a opacity, takže v OBS nic nepřepočítává layout.
//
// Ukázkový režim: ?mock&fx=sweep ho spouští každé 4 s.

const params = new URLSearchParams(location.search)
const INTERVAL_MS = params.has('mock') && params.get('fx') === 'sweep' ? 4_000 : 30_000

const isInGame = useIsInGame()
const run = ref(0)

const timer = setInterval(() => {
  if (isInGame.value) run.value++
}, INTERVAL_MS)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <!-- Nový klíč = nový prvek = animace znovu od začátku. -->
  <div v-if="isInGame && run > 0" :key="run" class="sweep" aria-hidden="true" />
</template>

<style scoped>
/* Horní hrana spodního pruhu je 221 px nad spodkem (1 px linka + 220 px). */
.sweep {
  position: absolute;
  left: 0;
  bottom: 220px;
  width: 300px;
  height: 2px;
  pointer-events: none;
  z-index: 20;
  opacity: 0;
  background: linear-gradient(90deg, transparent, #ff4d00 30%, #ffd166 50%, #ff4d00 70%, transparent);
  box-shadow: 0 0 12px 2px rgba(255, 120, 0, 0.55);
  animation: sweep 1.8s cubic-bezier(0.45, 0.05, 0.35, 1) forwards;
}

@keyframes sweep {
  0%   { transform: translateX(-320px); opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { transform: translateX(1940px); opacity: 0; }
}
</style>
