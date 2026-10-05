<script setup lang="ts">
import { computed } from "vue";
import { describeApiError } from "@/application/describe-api-error";

const props = defineProps<{ error: Error }>();
defineEmits<{ retry: [] }>();

const message = computed(() => describeApiError(props.error));
</script>

<template>
  <q-banner class="error-banner" role="alert">
    <template #avatar><q-icon name="error_outline" /></template>
    {{ message }}
    <template #action><q-btn flat no-caps dense label="Retry" class="retry" @click="$emit('retry')" /></template>
  </q-banner>
</template>

<style scoped>
/* aviso suave del diseño (ADR-048): el rojo pleno queda para el estado, no para llenar la pantalla */
.error-banner {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
  border: 1px solid color-mix(in srgb, var(--mt-err) 30%, transparent);
  border-radius: var(--mt-radius-lg);
  font-weight: 600;
}
.error-banner :deep(.q-icon) {
  color: var(--mt-err);
}
.retry {
  color: var(--mt-err-ink);
  font-weight: 800;
}
</style>
