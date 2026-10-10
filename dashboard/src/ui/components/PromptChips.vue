<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import type { PromptRefDto } from "@contract";
import Pill from "./Pill.vue";

/**
 * Las versiones de prompt del registro que usó una traza, conversación o item de evaluación (ADR-068). Cada una enlaza a esa
 * versión del prompt, donde están todas las trazas que la usaron. Vacío = no leyó ningún prompt del registro.
 */
const props = defineProps<{ prompts: PromptRefDto[]; max?: number }>();
const route = useRoute();
const shown = computed(() => props.prompts.slice(0, props.max ?? 3));
const hidden = computed(() => props.prompts.length - shown.value.length);
const to = (p: PromptRefDto) => ({ name: "prompts", params: { experimentId: String(route.params.experimentId) }, query: { open: p.name, version: String(p.version) } });
</script>

<template>
  <span v-if="prompts.length > 0" class="prompt-chips" data-testid="prompt-chips">
    <router-link
      v-for="p in shown"
      :key="`${p.name}@${p.version}`"
      :to="to(p)"
      class="prompt-chip"
      :title="`Prompt ${p.name}, version ${p.version}: open it`"
      :data-testid="`prompt-chip-${p.name}-${p.version}`"
      @click.stop
    ><Pill>{{ p.name }} <b>v{{ p.version }}</b></Pill></router-link>
    <span v-if="hidden > 0" class="more soft" :title="prompts.slice(shown.length).map((p) => `${p.name} v${p.version}`).join(', ')">+{{ hidden }}</span>
  </span>
</template>

<style scoped>
.prompt-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.prompt-chip {
  text-decoration: none;
  white-space: nowrap;
  font-family: var(--mt-font-mono, monospace);
  font-size: 11.5px;
}
.prompt-chip:hover {
  text-decoration: underline;
}
.more {
  font-size: 11.5px;
}
</style>
