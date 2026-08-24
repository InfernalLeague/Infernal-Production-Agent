<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useIngameSelector } from '@/composables/useIngame'

const CYCLE_MS = 8_000

const patch = useIngameSelector((s) => (s.gameData as any)?.patch ?? '', '')

const items = computed(() => {
  const list = ['INFERNAL LEAGUE']
  if (patch.value) list.push(`PATCH ${patch.value}`)
  return list
})

const idx = ref(0)
const current = computed(() => items.value[idx.value % items.value.length])

let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => { idx.value++ }, CYCLE_MS)
})
onUnmounted(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<template>
  <div class="gameinfo">
    <Transition name="gi" mode="out-in">
      <span :key="current" class="gameinfo__text">{{ current }}</span>
    </Transition>
  </div>
</template>

<style scoped>
.gameinfo {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  overflow: hidden;
}

.gameinfo__text {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 17px;
  letter-spacing: 0.10em;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gi-enter-active { transition: opacity 0.35s ease; }
.gi-leave-active { transition: opacity 0.25s ease; }
.gi-enter-from,
.gi-leave-to     { opacity: 0; }
</style>
