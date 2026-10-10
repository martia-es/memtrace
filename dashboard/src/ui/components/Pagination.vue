<script setup lang="ts">
import Button from "./Button.vue";

/** Pie de listas paginadas: resumen a la izquierda (slot) y Prev / Page n / m / Next a la derecha. */
const props = defineProps<{ page: number; pageCount: number }>();
const emit = defineEmits<{ "update:page": [page: number] }>();
</script>

<template>
  <div class="pager">
    <span class="muted"><slot /></span>
    <div class="controls">
      <Button size="sm" :disabled="props.page <= 1" data-testid="page-prev" @click="emit('update:page', props.page - 1)">Prev</Button>
      <span class="muted mono">Page {{ props.page }} / {{ props.pageCount }}</span>
      <Button size="sm" :disabled="props.page >= props.pageCount" data-testid="page-next" @click="emit('update:page', props.page + 1)">Next</Button>
    </div>
  </div>
</template>

<style scoped>
.pager { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; font-size: 12.5px; }
.controls { display: flex; align-items: center; gap: 10px; }
.muted { color: var(--mt-muted); }
.mono { font-family: var(--mt-mono); }
</style>
