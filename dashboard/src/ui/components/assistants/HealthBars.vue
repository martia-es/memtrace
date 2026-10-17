<script setup lang="ts">
import { computed } from "vue";
import type { HealthCheckDto } from "@contract";
import { HEALTH_LABEL, healthBuckets } from "@/domain/assistants";
import { t } from "../../i18n";

/** Barras de disponibilidad del último periodo: una por tramo, con el peor estado de sus sondeos (ADR-053). */
const props = withDefaults(defineProps<{ checks: HealthCheckDto[]; hours?: number; buckets?: number; nowMs: number }>(), { hours: 24, buckets: 48 });

const bars = computed(() => healthBuckets(props.checks, props.hours, props.buckets, props.nowMs));
const summary = computed(() => {
  if (props.checks.length === 0) return t("healthBars.no_health_checks_in_this_period");
  const down = props.checks.filter((c) => c.status === "down").length;
  return t("healthBars.count_health_checks_failed_failed", { count: props.checks.length, failed: down });
});
</script>

<template>
  <div class="bars" role="img" :aria-label="summary">
    <span v-for="(b, i) in bars" :key="i" class="bar" :class="b.status ?? 'none'" :title="b.status ? HEALTH_LABEL[b.status] : t('healthBars.no_check')" />
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 26px;
}
.bar {
  flex: 1;
  height: 100%;
  border-radius: 1px;
  background: var(--mt-brand);
}
.bar.degraded { background: var(--mt-warn); }
.bar.down { background: var(--mt-err); }
.bar.unknown { background: var(--mt-faint); }
.bar.none { background: var(--mt-line); height: 40%; }
</style>
