<script setup lang="ts">
import StatusChip from "./StatusChip.vue";

/** Estado de anotación humana de una fila: valoración baja, anotada o sin etiquetas. */
defineProps<{ rating?: { labels: number; low: boolean } }>();
</script>

<template>
  <StatusChip v-if="rating?.low" tone="highlight" label="Low rating" />
  <StatusChip v-else-if="rating" tone="info" label="Annotated" />
  <span v-else class="none">–</span>
</template>

<style scoped>
.none {
  color: var(--mt-faint);
}
</style>
