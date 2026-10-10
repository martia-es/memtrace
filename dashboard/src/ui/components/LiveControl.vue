<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { formatRelativeTime } from "@/domain/format";
import { REFRESH_OPTIONS, type RefreshSeconds } from "@/domain/refresh";
import Menu from "./Menu.vue";

defineProps<{ seconds: RefreshSeconds; updatedAt: number | null; loading?: boolean }>();
defineEmits<{ "update:seconds": [RefreshSeconds]; refresh: [] }>();

// Own clock so "updated N s ago" advances between refreshes
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(ticker));
</script>

<template>
  <button type="button" class="live" aria-haspopup="menu" aria-label="Auto-refresh">
    <span class="dot" :class="{ on: seconds > 0 }" aria-hidden="true" />
    {{ seconds > 0 ? "Live" : "Paused" }}
    <Menu auto-close anchor="bottom right" self="top right" :offset="[0, 6]">
      <div class="menu" role="group" aria-label="Refresh interval">
        <span class="status" aria-live="off">{{ updatedAt ? `Updated ${formatRelativeTime(new Date(updatedAt).toISOString(), now)}` : "Loading…" }}</span>
        <button
          v-for="s in REFRESH_OPTIONS"
          :key="s"
         
          type="button"
          class="opt"
          :aria-pressed="s === seconds"
          @click="$emit('update:seconds', s)"
        >
          {{ s === 0 ? "Off" : `Every ${s} s` }}
        </button>
        <button type="button" class="opt refresh" :disabled="loading" @click="$emit('refresh')">Refresh now</button>
      </div>
    </Menu>
  </button>
</template>

<style scoped>
.live {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  box-sizing: border-box;
  padding: 0 11px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.live:hover {
  background: var(--mt-soft);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--mt-faint);
}
.dot.on {
  background: var(--q-positive);
  animation: pulse 2s ease-in-out infinite;
}
.menu {
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 6px;
}
.status {
  padding: 4px 10px 6px;
  color: var(--mt-muted);
  font-size: 11.5px;
  white-space: nowrap;
}
.opt {
  padding: 7px 10px;
  border: 0;
  border-radius: var(--mt-radius-xs);
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.opt:hover {
  background: var(--mt-soft);
}
.opt[aria-pressed="true"] {
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.opt.refresh {
  margin-top: 4px;
  border-top: 1px solid var(--mt-line);
  border-radius: 0;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(33, 186, 69, 0.55); }
  50% { box-shadow: 0 0 0 5px rgba(33, 186, 69, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dot.on { animation: none; }
}
</style>
