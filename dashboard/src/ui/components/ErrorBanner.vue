<script setup lang="ts">
import { computed } from "vue";
import { describeApiError } from "@/application/describe-api-error";
import Button from "./Button.vue";

const props = defineProps<{ error: Error }>();
defineEmits<{ retry: [] }>();

const message = computed(() => describeApiError(props.error));
</script>

<template>
  <div class="error-banner" role="alert">
    <q-icon name="error_outline" class="icon" />
    <span class="msg">{{ message }}</span>
    <Button size="sm" class="retry" @click="$emit('retry')">Retry</Button>
  </div>
</template>

<style scoped>
/* aviso suave del diseño (ADR-048): el rojo pleno queda para el estado, no para llenar la pantalla */
.error-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
  border: 1px solid color-mix(in srgb, var(--mt-err) 30%, transparent);
  border-radius: var(--mt-radius-lg);
  font-weight: 600;
}
.icon {
  flex: none;
  color: var(--mt-err);
  font-size: 22px;
}
.msg {
  flex: 1;
  min-width: 0;
}
.retry {
  color: var(--mt-err-ink);
  font-weight: 800;
}
</style>
