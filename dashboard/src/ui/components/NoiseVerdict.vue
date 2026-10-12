<script setup lang="ts">
import { computed } from "vue";
import { marginLabel, verdictExplanation, verdictLabel, verdictTone, type EvaluatorNoiseComparison } from "../noise-verdict";
import NoiseBand from "./NoiseBand.vue";
import Pill from "./Pill.vue";

/** Veredicto de un evaluador al comparar dos runs contra el ruido medido (ADR-097): por encima, dentro o sin medir. */
const props = defineProps<{ comparison: EvaluatorNoiseComparison }>();
const tone = computed(() => verdictTone(props.comparison));
const margin = computed(() => marginLabel(props.comparison));
</script>

<template>
  <div class="verdict" :title="verdictExplanation(comparison)">
    <Pill :tone="tone" :outline="comparison.verdict === 'not_measured'" data-testid="noise-verdict">{{ verdictLabel(comparison) }}</Pill>
    <NoiseBand :delta="comparison.delta" :margin="comparison.margin" :verdict="comparison.verdict" :tone="tone" />
    <span class="note">{{ margin ? `noise ${margin}` : "set repeats=3 to measure" }}</span>
  </div>
</template>

<style scoped>
.verdict { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; min-width: 0; }
.note { font-size: 11.5px; color: var(--mt-muted); }
</style>
