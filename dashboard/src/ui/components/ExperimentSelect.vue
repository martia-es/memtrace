<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, ref } from "vue";
import type { ExperimentDto } from "@/application/identity-api";

interface Props {
  modelValue: string | null;
  options: ExperimentDto[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), { loading: false });
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const query = ref("");
const current = computed(() => props.options.find((e) => e.id === props.modelValue) ?? null);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? props.options.filter((e) => `${e.name} ${e.serviceName}`.toLowerCase().includes(q)) : props.options;
});
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

const pick = (id: string) => {
  if (id !== props.modelValue) emit("update:modelValue", id);
};
</script>

<template>
  <button type="button" class="exp-trigger" aria-haspopup="listbox" data-testid="experiment-switcher">
    <span class="exp-avatar" aria-hidden="true">{{ initials(current?.name ?? "MT") }}</span>
    <span class="exp-text">
      <span class="exp-label">Experiment</span>
      <span class="exp-name">{{ current?.name ?? (loading ? "Loading…" : "Select experiment") }}</span>
    </span>
    <svg class="exp-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
    </svg>
    <q-menu fit :offset="[0, 6]" class="exp-popover" @before-show="query = ''">
      <div v-if="options.length > 6" class="exp-search">
        <TextInput v-model="query" type="search" size="sm" placeholder="Search experiments…" aria-label="Search experiments" />
      </div>
      <ul class="exp-list" role="listbox" aria-label="Experiments">
        <li v-for="e in filtered" :key="e.id" role="option" :aria-selected="e.id === modelValue">
          <button v-close-popup type="button" class="exp-option" :class="{ selected: e.id === modelValue }" @click="pick(e.id)">
            <span class="exp-avatar" aria-hidden="true">{{ initials(e.name) }}</span>
            <span class="exp-text">
              <span class="exp-name">{{ e.name }}</span>
              <span class="exp-service">{{ e.serviceName }}</span>
            </span>
            <svg v-if="e.id === modelValue" class="exp-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </button>
        </li>
        <li v-if="!filtered.length" class="exp-empty">No experiments found</li>
      </ul>
    </q-menu>
  </button>
</template>

<style scoped>
.exp-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.exp-trigger:hover,
.exp-trigger:focus-visible {
  border-color: var(--mt-accent);
  box-shadow: 0 0 0 3px var(--mt-accent-soft);
  outline: none;
}
.exp-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font-size: 12px;
  font-weight: 800;
}
.exp-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.exp-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mt-faint);
}
.exp-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--mt-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.exp-chevron {
  flex-shrink: 0;
  color: var(--mt-muted);
}
</style>

<style>
.exp-popover {
  min-width: 240px;
  border-radius: var(--mt-radius-lg);
  box-shadow: var(--mt-shadow), 0 0 0 1px var(--mt-line);
  overflow: hidden;
}
.exp-popover .exp-search {
  padding: 8px 8px 4px;
}
.exp-popover .exp-search input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
}
.exp-popover .exp-search input:focus {
  outline: none;
  border-color: var(--mt-accent);
}
.exp-popover .exp-list {
  max-height: 320px;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
}
.exp-popover .exp-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.exp-popover .exp-option:hover {
  background: var(--mt-soft);
}
.exp-popover .exp-option.selected {
  background: var(--mt-accent-tint);
}
.exp-popover .exp-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
  font-size: 11px;
  font-weight: 800;
}
.exp-popover .exp-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.exp-popover .exp-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--mt-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.exp-popover .exp-service {
  font-size: 11.5px;
  color: var(--mt-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.exp-popover .exp-check {
  flex-shrink: 0;
  color: var(--mt-accent-text);
}
.exp-popover .exp-empty {
  padding: 12px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--mt-muted);
}
</style>
