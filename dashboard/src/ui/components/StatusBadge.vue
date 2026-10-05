<script setup lang="ts">
import type { StatusCodeDto } from "@contract";
import { computed } from "vue";
import StatusChip from "./StatusChip.vue";

const props = defineProps<{ status: StatusCodeDto; errorCount?: number; showLabel?: boolean }>();

const chip = computed(() => {
  switch (props.status) {
    case "ok":
      return { tone: "ok" as const, label: "OK" };
    case "error":
      return { tone: "error" as const, label: "Error" };
    default:
      return { tone: "neutral" as const, label: "Unset" };
  }
});
</script>

<template>
  <span class="status-badge">
    <StatusChip :tone="chip.tone" :label="chip.label" />
    <span v-if="errorCount && errorCount > 0" class="inner-errors" :title="`${errorCount} ${errorCount === 1 ? 'span' : 'spans'} with error inside the trace`">{{ errorCount }} failed</span>
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.inner-errors {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--mt-err-ink);
}
</style>
