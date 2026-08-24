<script setup lang="ts">
import BanSlot from './BanSlot.vue'
import PickSlot from './PickSlot.vue'

interface BanData {
  imgUrl?: string
  name?: string
  isActive: boolean
}

interface SlotData {
  player: string
  championName?: string
  loadingImgUrl?: string
  isActive: boolean
}

interface Props {
  side: 'blue' | 'red'
  bans: BanData[]
  slots: SlotData[]
}

defineProps<Props>()
</script>

<template>
  <div class="team-section" :class="`team-section--${side}`">

    <!-- Bans row (40px) -->
    <div class="bans-row" :class="side === 'red' && 'bans-row--rev'">
      <BanSlot
        v-for="(ban, i) in bans"
        :key="i"
        :img-url="ban.imgUrl"
        :name="ban.name"
        :is-active="ban.isActive"
      />
    </div>

    <!-- Picks row (190px) — 5 horizontal cards -->
    <div class="picks-row" :class="side === 'red' && 'picks-row--rev'">
      <PickSlot
        v-for="(slot, i) in slots"
        :key="i"
        :player="slot.player"
        :champion-name="slot.championName"
        :loading-img-url="slot.loadingImgUrl"
        :is-active="slot.isActive"
        :side="side"
      />
    </div>

  </div>
</template>

<style scoped>
.team-section {
  width: 860px;
  height: 230px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex-shrink: 0;
}

/* ── Bans row (40px) ─────────────────────────────── */
.bans-row {
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
}

.bans-row--rev {
  flex-direction: row-reverse;
}

/* ── Picks row (190px) ───────────────────────────── */
.picks-row {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.picks-row--rev {
  flex-direction: row-reverse;
}
</style>
