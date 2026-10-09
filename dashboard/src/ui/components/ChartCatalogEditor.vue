<script setup lang="ts">
import type { ChartCatalogEntryDto } from "@contract";
import type { RangeParams } from "@/application/trace-api";
import ChartCatalogTable from "./ChartCatalogTable.vue";
import Modal from "./Modal.vue";

/** "Customize names" (ADR-078): la tabla del catálogo en una ventana, para editar sin salir del builder de Custom charts. */
defineProps<{ experimentId: string; range: RangeParams; entries: ChartCatalogEntryDto[] }>();
const emit = defineEmits<{ close: []; changed: [entries: ChartCatalogEntryDto[]] }>();
</script>

<template>
  <Modal title="Customize names" wide @close="emit('close')">
    <div class="wrap">
      <p class="intro">Give each step and attribute the name your team uses. The new name appears in every chart, including the ones already saved. Leave it empty to use the automatic name.</p>
      <ChartCatalogTable :experiment-id="experimentId" :range="range" :entries="entries" @changed="emit('changed', $event)" />
    </div>
  </Modal>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; gap: 16px; min-width: min(720px, 86vw); }
.intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mt-muted); }
</style>
