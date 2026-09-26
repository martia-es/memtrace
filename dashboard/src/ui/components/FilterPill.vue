<script setup lang="ts">
import { computed } from "vue";

export interface PillOption {
  label: string;
  value: string;
}

const props = defineProps<{ label: string; modelValue: string | undefined; options: PillOption[]; allLabel?: string }>();
defineEmits<{ "update:modelValue": [string | undefined] }>();

const current = computed(() => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue ?? props.allLabel ?? "Todos");
</script>

<template>
  <button type="button" class="pill" :class="{ active: modelValue !== undefined }" :aria-label="`${label}: ${current}`">
    <span class="k">{{ label }}</span>{{ current }}
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    <q-menu auto-close anchor="bottom left" self="top left" :offset="[0, 6]" class="pill-menu">
      <q-list dense style="min-width: 160px">
        <q-item clickable :active="modelValue === undefined" @click="$emit('update:modelValue', undefined)"><q-item-section>{{ allLabel ?? "Todos" }}</q-item-section></q-item>
        <q-item v-for="o in options" :key="o.value" clickable :active="modelValue === o.value" @click="$emit('update:modelValue', o.value)">
          <q-item-section>{{ o.label }}</q-item-section>
        </q-item>
        <q-item v-if="options.length === 0" dense><q-item-section class="text-grey-7">Sin opciones</q-item-section></q-item>
      </q-list>
    </q-menu>
  </button>
</template>

<style scoped>
.pill {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 1px solid #e3eae5;
  border-radius: 18px;
  background: #fff;
  color: var(--mt-ink);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.pill.active {
  border-color: var(--mt-violet);
  background: #f5f2ff;
}
.k {
  color: var(--mt-muted);
}
</style>
