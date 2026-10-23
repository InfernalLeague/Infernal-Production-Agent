<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useIsInGame } from '@/composables/useIngame'

// ── Jiskra přes spodní pruh a rám minimapy ──────────────────────────────────
// Jednou za minutu, jen během hry (celé kolo trvá 6 s):
//   1. červená jiskra přejede po horní lince spodního pruhu zleva až k rámu
//      minimapy,
//   2. červená i žlutá část rámu dvakrát objedou minimapu dokola,
//   3. z rohu vyrazí zpátky doleva žlutá jiskra.
// Rám se točí jen o celé otáčky, takže stojí vždy v klidové poloze: červená
// vpravo nahoře, žlutá vlevo dole. Točí se přes úhel gradientu (@property
// --mf-angle) ve vrstvě nad MinimapFrame — začíná i končí v 45°, přechod
// mezi vrstvou a rámem tedy není vidět.
//
// Ukázkový režim: ?mock&fx=sweep ho spouští každých 7 s.

const params = new URLSearchParams(location.search)
const INTERVAL_MS = params.has('mock') && params.get('fx') === 'sweep' ? 7_000 : 60_000

const isInGame = useIsInGame()
const run = ref(0)

const timer = setInterval(() => {
  if (isInGame.value) run.value++
}, INTERVAL_MS)
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <!-- Nový klíč = nové prvky = animace znovu od začátku. -->
  <div v-if="isInGame && run > 0" :key="run" class="sweep" aria-hidden="true">
    <div class="spark spark--red" />
    <div class="lap" />
    <div class="spark spark--gold" />
  </div>
</template>

<style scoped>
@property --mf-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 45deg;
}

.sweep {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 20;
}

/* Horní hrana spodního pruhu je 221 px nad spodkem (1 px linka + 220 px).
   Rám minimapy začíná 221 px od pravého okraje, tj. na x = 1699 px. */
.spark {
  position: absolute;
  left: 0;
  bottom: 220px;
  width: 300px;
  height: 2px;
  opacity: 0;
}

/* Červená jede doprava, hlava (nejjasnější místo) je vpravo. */
.spark--red {
  background: linear-gradient(90deg, transparent, #ef4444 65%, #ffb199 100%);
  box-shadow: 0 0 12px 2px rgba(239, 68, 68, 0.6);
  animation: spark-in 1.6s cubic-bezier(0.5, 0, 0.75, 0.4) forwards;
}

/* Žlutá jede zpátky doleva, hlava je vlevo. */
.spark--gold {
  background: linear-gradient(270deg, transparent, #fbbc23 65%, #fff1c2 100%);
  box-shadow: 0 0 12px 2px rgba(251, 188, 35, 0.6);
  animation: spark-out 1.6s 4.4s cubic-bezier(0.25, 0.6, 0.5, 1) both;
}

@keyframes spark-in {
  0%   { transform: translateX(-320px); opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { transform: translateX(1399px); opacity: 0; }
}

@keyframes spark-out {
  0%   { transform: translateX(1399px); opacity: 0; }
  8%   { opacity: 1; }
  92%  { opacity: 1; }
  100% { transform: translateX(-320px); opacity: 0; }
}

/* Vrstva přesně přes MinimapFrame: stejný gradient a maska, jen se točí. */
.lap {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 221px;
  height: 221px;
  padding: 10px;
  opacity: 0;
  background: linear-gradient(var(--mf-angle), #fbbc23 0%, #090502 40%, #090502 60%, #ef4444 100%);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: destination-out;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  animation: lap 6s linear forwards;
}

/* Úhel gradientu míří k červené: 45° = klid (červená vpravo nahoře, žlutá
   vlevo dole). Dvě celé otáčky (45° → 765°) mezi příjezdem červené jiskry
   (1,6 s) a odjezdem žluté (4,4 s). */
@keyframes lap {
  0%    { --mf-angle: 45deg;  opacity: 0; filter: brightness(1); }
  20%   { --mf-angle: 45deg;  opacity: 1; }
  26.7% { --mf-angle: 45deg;  filter: brightness(1.2); animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1); }
  50%   { filter: brightness(1.6); }
  73.3% { --mf-angle: 765deg; filter: brightness(1.2); }
  90%   { --mf-angle: 765deg; opacity: 1; filter: brightness(1); }
  100%  { --mf-angle: 765deg; opacity: 0; }
}
</style>
