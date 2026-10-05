<script setup lang="ts">
import { useRoute } from "vue-router";

/**
 * Evaluations groups Runs and Datasets under one menu entry (ADR-048). The tabs keep each list on its own route, so
 * deep links, back/forward and the detail pages keep working exactly as before.
 */
const route = useRoute();
const TABS = [
  { name: "runs", label: "Runs" },
  { name: "datasets", label: "Datasets" },
] as const;
</script>

<template>
  <nav class="eval-tabs" aria-label="Evaluations">
    <router-link
      v-for="t in TABS"
      :key="t.name"
      :to="{ name: t.name, params: { experimentId: route.params.experimentId } }"
      class="eval-tab"
      :class="{ active: route.meta.section === t.name }"
      :aria-current="route.meta.section === t.name ? 'page' : undefined"
    >{{ t.label }}</router-link>
  </nav>
</template>

<style scoped>
.eval-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--mt-line);
  flex-shrink: 0;
}
.eval-tab {
  padding: 9px 12px;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  color: var(--mt-muted);
  font-weight: 700;
  text-decoration: none;
}
.eval-tab:hover {
  color: var(--mt-ink);
}
.eval-tab.active {
  color: var(--mt-ink);
  border-bottom-color: var(--mt-accent);
}
</style>
