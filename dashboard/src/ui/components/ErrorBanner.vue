<script setup lang="ts">
import { computed } from "vue";
import { ApiError } from "@/application/trace-api";

const props = defineProps<{ error: Error }>();
defineEmits<{ retry: [] }>();

const message = computed(() => {
  const e = props.error;
  if (e instanceof ApiError) {
    if (e.status === 0) return "No se pudo contactar con la API. ¿Está en marcha (`npm run dev` en api/) y el proxy apunta a ella?";
    if (e.status === 503) return "El almacén de trazas (ClickHouse) no responde. Comprueba `make status`.";
    if (e.status === 404) return "No encontrado. Si es una traza, puede estar fuera de la retención (30 días).";
    return e.detail ?? e.title;
  }
  return e.message;
});
</script>

<template>
  <q-banner rounded class="bg-negative text-white" role="alert">
    <template #avatar><q-icon name="error_outline" /></template>
    {{ message }}
    <template #action><q-btn flat label="Reintentar" @click="$emit('retry')" /></template>
  </q-banner>
</template>
