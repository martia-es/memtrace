<script setup lang="ts">
import StatusChip from "./StatusChip.vue";
import { t } from "../i18n";

/** Estado de anotación humana de una fila: valoración baja, anotada o sin etiquetas. */
defineProps<{ rating?: { labels: number; low: boolean } }>();
</script>

<template>
  <StatusChip v-if="rating?.low" tone="highlight" :label="t('annotationChip.low_rating')" />
  <StatusChip v-else-if="rating" tone="info" :label="t('annotationChip.annotated')" />
  <span v-else class="none">–</span>
</template>

<style scoped>
.none {
  color: var(--mt-faint);
}
</style>
