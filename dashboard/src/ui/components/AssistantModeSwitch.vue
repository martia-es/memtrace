<script setup lang="ts">
import { computed } from "vue";
import { allowedModes, MODE_LABELS, type AssistantDisplayMode, type AssistantDisplayTheme } from "@/domain/assistant-display";
import { setUserMode } from "../composables/useAssistantDisplay";

/** Selector de modo en la cabecera del chat: solo ofrece los que la organización permite. */
const props = defineProps<{ theme: AssistantDisplayTheme | null; current: AssistantDisplayMode }>();
const emit = defineEmits<{ select: [mode: AssistantDisplayMode] }>();
const modes = computed(() => allowedModes(props.theme));

function pick(mode: AssistantDisplayMode) {
  if (mode === props.current) return;
  setUserMode(mode);
  emit("select", mode);
}
</script>

<template>
  <div v-if="modes.length > 1" class="switch" role="group" aria-label="Assistant view">
    <button v-for="m in modes" :key="m" type="button" class="mode" :class="{ on: m === current }" :aria-pressed="m === current" :title="MODE_LABELS[m]" :aria-label="MODE_LABELS[m]" :data-testid="`mode-${m}`" @click="pick(m)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <template v-if="m === 'bubble'"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></template>
        <template v-else-if="m === 'dock'"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></template>
        <template v-else><path d="M14 3h7v7M10 21H3v-7M21 3l-7 7M3 21l7-7" /></template>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.switch { display: inline-flex; gap: 1px; padding: 2px; margin-right: 4px; background: var(--mt-line-2); border-radius: var(--mt-radius-sm); }
.mode { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; padding: 0; color: var(--mt-muted); background: none; border: none; border-radius: var(--mt-radius-xs); cursor: pointer; }
.mode:hover { color: var(--mt-ink); }
.mode.on { color: var(--mt-accent-text); background: var(--mt-card); }
.mode:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 1px; }
</style>
