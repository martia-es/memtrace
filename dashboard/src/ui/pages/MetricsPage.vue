<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core";
import { useQuasar } from "quasar";
import { computed, watch } from "vue";
import { chartColors } from "../chart-theme";
import { formatCount, formatDuration, formatPercent } from "@/domain/format";
import { resolveRange } from "@/domain/time-range";
import EChart from "../components/EChart.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterBar from "../components/FilterBar.vue";
import KpiCard from "../components/KpiCard.vue";
import { useAsync } from "../composables/useAsync";
import { useAutoRefresh } from "../composables/useAutoRefresh";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";

const api = useTraceApi();
const $q = useQuasar();
const f = useFilters();

const overview = useAsync((signal) => api.getOverview({ ...resolveRange(f.range.value, Date.now()), service: f.service.value }, signal));
const services = useAsync((signal) => api.listServices(resolveRange(f.range.value, Date.now()), signal));
const reload = () => {
  void overview.run();
  void services.run();
};
watch([f.range, f.service], reload, { immediate: true });
const live = useAutoRefresh(() => void overview.run());

const data = computed(() => overview.data.value);
const empty = computed(() => data.value !== null && data.value.totals.traces === 0 && data.value.totals.spans === 0);

const longRange = computed(() => (data.value ? Date.parse(data.value.range.to) - Date.parse(data.value.range.from) > 2 * 86_400_000 : false));
const label = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", longRange.value ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

function baseOption(): EChartsCoreOption {
  const c = chartColors($q.dark.isActive);
  return {
    textStyle: { color: c.text },
    grid: { left: 48, right: 48, top: 36, bottom: 28 },
    tooltip: { trigger: "axis", backgroundColor: $q.dark.isActive ? "#1d2635" : "#fff", textStyle: { color: c.text }, borderColor: c.grid },
    legend: { top: 0, textStyle: { color: c.muted } },
    xAxis: { type: "category", axisLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
  };
}

const activityOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const base = baseOption() as Record<string, unknown>;
  return {
    ...base,
    xAxis: { ...(base.xAxis as object), data: d?.timeseries.map((p) => label(p.bucketStart)) ?? [] },
    yAxis: [
      { type: "value", minInterval: 1, splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
      { type: "value", splitLine: { show: false }, axisLabel: { color: c.muted, formatter: (v: number) => formatDuration(v) } },
    ],
    series: [
      { name: "Trazas", type: "bar", stack: "t", data: d?.timeseries.map((p) => p.traces - p.errorTraces) ?? [], itemStyle: { color: c.primary } },
      { name: "Con error", type: "bar", stack: "t", data: d?.timeseries.map((p) => p.errorTraces) ?? [], itemStyle: { color: c.danger } },
      { name: "Latencia p95", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, data: d?.timeseries.map((p) => p.p95Ms) ?? [], itemStyle: { color: c.accent } },
    ],
  };
});

const tokensOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const base = baseOption() as Record<string, unknown>;
  return {
    ...base,
    legend: { show: false },
    xAxis: { ...(base.xAxis as object), data: d?.timeseries.map((p) => label(p.bucketStart)) ?? [] },
    yAxis: { type: "value", splitLine: { lineStyle: { color: c.grid } }, axisLabel: { color: c.muted } },
    series: [{ name: "Tokens", type: "bar", data: d?.timeseries.map((p) => p.totalTokens) ?? [], itemStyle: { color: c.primary } }],
  };
});

const modelColumns = [
  { name: "model", label: "Modelo", field: "model", align: "left" as const },
  { name: "calls", label: "Llamadas", field: "calls", align: "right" as const, format: (v: number) => formatCount(v) },
  { name: "in", label: "Tokens entrada", field: "inputTokens", align: "right" as const, format: (v: number) => formatCount(v) },
  { name: "out", label: "Tokens salida", field: "outputTokens", align: "right" as const, format: (v: number) => formatCount(v) },
  { name: "p95", label: "p95", field: "p95Ms", align: "right" as const, format: (v: number) => formatDuration(v) },
];
const toolColumns = [
  { name: "tool", label: "Herramienta", field: "tool", align: "left" as const },
  { name: "calls", label: "Llamadas", field: "calls", align: "right" as const, format: (v: number) => formatCount(v) },
  { name: "errors", label: "Errores", field: "errors", align: "right" as const, format: (v: number) => formatCount(v) },
  { name: "p95", label: "p95", field: "p95Ms", align: "right" as const, format: (v: number) => formatDuration(v) },
];
</script>

<template>
  <q-page padding class="page">
    <div class="text-h6 q-mb-sm">Métricas</div>

    <FilterBar
      :range="f.range.value"
      :service="f.service.value"
      :services="services.data.value?.items ?? []"
      :loading="overview.loading.value"
      @update:range="f.setRange"
      @update:service="f.setService"
      @refresh="reload"
    >
      <q-toggle v-model="live.enabled.value" dense label="En vivo (10 s)" />
    </FilterBar>

    <ErrorBanner v-if="overview.error.value" class="q-mt-md" :error="overview.error.value" @retry="reload" />
    <div v-else-if="overview.loading.value && !data" class="row justify-center q-pa-xl"><q-spinner size="32px" color="primary" /></div>

    <EmptyState v-else-if="empty" icon="insights" title="Sin datos en este rango">Ejecuta un agente instrumentado o amplía el rango de tiempo.</EmptyState>

    <template v-else-if="data">
      <div class="kpis q-mt-md">
        <KpiCard label="Trazas" :value="formatCount(data.totals.traces)" :hint="`${formatCount(data.totals.spans)} spans`" />
        <KpiCard label="Tasa de error (raíz)" :value="formatPercent(data.totals.errorRate)" :hint="`${data.totals.errorTraces} trazas con el raíz fallido`" :tone="data.totals.errorTraces > 0 ? 'negative' : 'default'" />
        <KpiCard label="Latencia p50" :value="formatDuration(data.latencyMs.p50)" />
        <KpiCard label="Latencia p95" :value="formatDuration(data.latencyMs.p95)" />
        <KpiCard label="Latencia p99" :value="formatDuration(data.latencyMs.p99)" />
        <KpiCard label="Tokens" :value="formatCount(data.totals.totalTokens)" :hint="`${formatCount(data.totals.inputTokens)} entrada · ${formatCount(data.totals.outputTokens)} salida`" />
      </div>

      <div class="charts q-mt-md">
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle2">Actividad y latencia p95</div>
            <EChart :option="activityOption" label="Trazas por intervalo y latencia p95" />
          </q-card-section>
        </q-card>
        <q-card flat bordered>
          <q-card-section>
            <div class="text-subtitle2">Tokens por intervalo</div>
            <EChart :option="tokensOption" label="Tokens consumidos por intervalo" />
          </q-card-section>
        </q-card>
      </div>

      <div class="tables q-mt-md">
        <q-table flat bordered dense title="Por modelo" :rows="data.byModel" :columns="modelColumns" row-key="model" hide-pagination :rows-per-page-options="[0]" no-data-label="Sin llamadas a LLM" />
        <q-table flat bordered dense title="Por herramienta" :rows="data.byTool" :columns="toolColumns" row-key="tool" hide-pagination :rows-per-page-options="[0]" no-data-label="Sin herramientas ejecutadas" />
      </div>
    </template>
  </q-page>
</template>

<style scoped>
.page {
  max-width: 1300px;
  margin: 0 auto;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
}
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 12px;
}
.tables {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 12px;
}
</style>
