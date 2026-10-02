<script setup lang="ts">
import { useIsInGame } from '@/composables/useIngame'

const isInGame = useIsInGame()
</script>

<template>
  <Transition name="strip">
    <div v-if="isInGame" class="mframe" />
  </Transition>
</template>

<style scoped>
.mframe {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 221px;
  height: 221px;
  pointer-events: none;

  /*
   * Gradient: gold (top-left) → black (center) → red (bottom-right)
   * CSS mask with exclude composite creates a hollow rectangle —
   * only the border strip is visible, the center is transparent.
   * --bw controls border width.
   */
  --bw: 10px;
  --strip-delay: 180ms;
  padding: var(--bw);

  background: linear-gradient(
    45deg,
    #fbbc23 0%,
    #090502 40%,
    #090502 60%,
    #ef4444 100%
  );

  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: destination-out;

  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
}

</style>
