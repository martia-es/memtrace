<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import OfflineEvalPanel from "../components/OfflineEvalPanel.vue";
import PageHeader from "../components/PageHeader.vue";
import { useFilters } from "../composables/useFilters";

/**
 * Evaluations › Trends: how offline evaluation scores evolve across runs (ADR-059). It used to be the "Offline evals"
 * tab of Overview; `?compare=<baseline>,<candidate>` deep-links here from the run list's "Compare runs".
 */
const route = useRoute();
const f = useFilters();
const range = computed(() => f.resolve());
const compareIds = computed<[string, string] | null>(() => {
  const [a, b] = String(route.query.compare ?? "").split(",");
  return a && b ? [a, b] : null;
});
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Evaluations' }, { label: 'Trends' }]" icon="M3 3v18h18M7 14l4-4 3 3 5-6" title="Trends" />
    <OfflineEvalPanel :range="range" :compare-ids="compareIds" />
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
</style>
