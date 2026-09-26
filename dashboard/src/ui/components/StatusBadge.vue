<script setup lang="ts">
import type { StatusCodeDto } from "@contract";
import { statusMeta } from "@/domain/meta";

defineProps<{ status: StatusCodeDto; errorCount?: number; showLabel?: boolean }>();
</script>

<template>
  <span class="status-badge">
    <q-icon :name="statusMeta(status).icon" :color="statusMeta(status).color" size="20px" :aria-label="statusMeta(status).label">
      <q-tooltip>{{ statusMeta(status).label }}</q-tooltip>
    </q-icon>
    <span v-if="showLabel" class="q-ml-xs">{{ statusMeta(status).label }}</span>
    <q-badge v-if="errorCount && errorCount > 0" color="negative" class="q-ml-xs" :label="errorCount">
      <q-tooltip>{{ errorCount }} {{ errorCount === 1 ? "span con error" : "spans con error" }} dentro de la traza</q-tooltip>
    </q-badge>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
}
</style>
