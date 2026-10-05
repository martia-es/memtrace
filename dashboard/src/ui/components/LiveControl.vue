<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { formatRelativeTime } from "@/domain/format";
import { REFRESH_OPTIONS, type RefreshSeconds } from "@/domain/refresh";

defineProps<{ seconds: RefreshSeconds; updatedAt: number | null }>();
defineEmits<{ "update:seconds": [RefreshSeconds] }>();

// Own clock so "updated N s ago" advances between refreshes
const now = ref(Date.now());
const ticker = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(ticker));
</script>

<template>
  <div class="row items-center q-gutter-x-sm no-wrap live" role="group" aria-label="Auto-refresh">
    <span class="dot" :class="{ on: seconds > 0 }" aria-hidden="true" />
    <q-btn-toggle
      :model-value="seconds"
      :options="REFRESH_OPTIONS.map((s) => ({ label: s === 0 ? 'Off' : `${s} s`, value: s }))"
      dense
      no-caps
      unelevated
      toggle-color="primary"
      class="toggle-group"
      aria-label="Refresh interval"
      @update:model-value="$emit('update:seconds', $event)"
    />
    <span class="text-caption text-grey-7 status" aria-live="off">
      {{ updatedAt ? `Updated ${formatRelativeTime(new Date(updatedAt).toISOString(), now)}` : "Loading…" }}
    </span>
  </div>
</template>

<style scoped>
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--q-grey-6, #999);
}
.dot.on {
  background: var(--q-positive);
  animation: pulse 2s ease-in-out infinite;
}
.status {
  white-space: nowrap;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(33, 186, 69, 0.55); }
  50% { box-shadow: 0 0 0 5px rgba(33, 186, 69, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dot.on { animation: none; }
}
</style>
