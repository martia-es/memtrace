<script setup lang="ts">
import { computed } from "vue";
import Menu from "./Menu.vue";

export interface PillOption {
  label: string;
  value: string;
}

const props = defineProps<{ label: string; modelValue: string | undefined; options: PillOption[]; allLabel?: string }>();
defineEmits<{ "update:modelValue": [string | undefined] }>();

const current = computed(() => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue ?? props.allLabel ?? "All");
</script>

<template>
  <button type="button" class="pill" :class="{ active: modelValue !== undefined }" :aria-label="`${label}: ${current}`">
    <span class="k">{{ label }}</span>{{ current }}
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    <Menu auto-close anchor="bottom left" self="top left" :offset="[0, 6]" class="pill-menu">
      <div class="opts">
        <button type="button" class="opt" :class="{ active: modelValue === undefined }" @click="$emit('update:modelValue', undefined)">{{ allLabel ?? "All" }}</button>
        <button v-for="o in options" :key="o.value" type="button" class="opt" :class="{ active: modelValue === o.value }" @click="$emit('update:modelValue', o.value)">{{ o.label }}</button>
        <span v-if="options.length === 0" class="opt none">No options</span>
      </div>
    </Menu>
  </button>
</template>

<style scoped>
.pill {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.pill.active {
  border-color: var(--mt-accent);
  background: var(--wf-selected);
}
.k {
  color: var(--mt-muted);
}
.opts {
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 4px;
}
.opt {
  display: block;
  padding: 7px 12px;
  border: 0;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.opt:hover { background: var(--mt-soft); }
.opt.active { background: var(--mt-accent-tint); color: var(--mt-accent-text); font-weight: 700; }
.opt.none { color: var(--mt-muted); cursor: default; }
.opt.none:hover { background: transparent; }
</style>
