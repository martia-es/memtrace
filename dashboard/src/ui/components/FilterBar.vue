<script setup lang="ts">
import { ref, watch } from "vue";
import { RANGE_PRESETS, earliestCustomDay, type CustomRange, type RangeSelection } from "@/domain/time-range";
import Menu from "./Menu.vue";
import Button from "./Button.vue";

const props = defineProps<{ range: RangeSelection; custom?: CustomRange }>();
const emit = defineEmits<{ "update:range": [Exclude<RangeSelection, "custom">]; "update:custom": [CustomRange] }>();

const earliestDay = earliestCustomDay(Date.now());
const from = ref(props.custom?.from ?? "");
const to = ref(props.custom?.to ?? "");
watch(() => props.custom, (c) => ((from.value = c?.from ?? from.value), (to.value = c?.to ?? to.value)));
const valid = () => Boolean(from.value) && Boolean(to.value) && from.value <= to.value && from.value >= earliestDay;
const menu = ref<{ hide: () => void } | null>(null);
const apply = () => {
  emit("update:custom", { from: from.value, to: to.value });
  menu.value?.hide();
};
const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
</script>

<template>
  <div class="range" role="group" aria-label="Time range">
    <button v-for="p in RANGE_PRESETS" :key="p.key" type="button" :aria-pressed="p.key === range" @click="emit('update:range', p.key)">{{ p.label }}</button>
    <button type="button" class="custom" :aria-pressed="range === 'custom'" aria-haspopup="dialog" data-testid="custom-range">
      {{ range === "custom" && custom ? `${fmt(custom.from)} – ${fmt(custom.to)}` : "Custom" }}
      <Menu ref="menu" anchor="bottom right" self="top right" :offset="[0, 6]">
        <form class="menu" @submit.prevent="valid() && apply()">
          <label>From <input v-model="from" type="date" :min="earliestDay" :max="to || undefined" required /></label>
          <label>To <input v-model="to" type="date" :min="from || earliestDay" required /></label>
          <Button variant="primary" size="sm" type="submit" class="apply" :disabled="!valid()">Apply</Button>
        </form>
      </Menu>
    </button>
  </div>
  <slot />
</template>

<style scoped>
.range {
  display: flex;
  height: 32px;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
}
.range button {
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}
.range button:hover {
  color: var(--mt-ink);
}
.range button[aria-pressed="true"] {
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.custom {
  border-left: 1px solid var(--mt-line) !important;
}
.menu {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.menu label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
}
.menu input {
  height: 32px;
  box-sizing: border-box;
  padding: 0 8px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-xs);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 500;
}


</style>
