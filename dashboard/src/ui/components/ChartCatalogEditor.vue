<script setup lang="ts">
import type { ChartCatalogEntryDto } from "@contract";
import type { RangeParams } from "@/application/trace-api";
import ChartCatalogTable from "./ChartCatalogTable.vue";
import Modal from "./Modal.vue";
import { t } from "../i18n";

/** "Customize names" (ADR-078): la tabla del catálogo en una ventana, para editar sin salir del builder de Custom charts. */
defineProps<{ experimentId: string; range: RangeParams; entries: ChartCatalogEntryDto[] }>();
const emit = defineEmits<{ close: []; changed: [entries: ChartCatalogEntryDto[]] }>();
</script>

<template>
  <Modal :title="t('chartCatalogEditor.customize_names')" wide @close="emit('close')">
    <div class="wrap">
      <p class="intro">{{ t("chartCatalogEditor.give_each_step_and_attribute_the") }}</p>
      <ChartCatalogTable :experiment-id="experimentId" :range="range" :entries="entries" @changed="emit('changed', $event)" />
    </div>
  </Modal>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; gap: 16px; min-width: min(720px, 86vw); }
.intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mt-muted); }
</style>
