<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core";
import { computed, watch } from "vue";
import { chartColors } from "../chart-theme";
import { formatCount, formatDuration, formatPercent } from "@/domain/format";
import { resolveRange } from "@/domain/time-range";
import { useQuasar } from "quasar";
import EChart from "../components/EChart.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import { useAsync } from "../composables/useAsync";
import { setRefreshSeconds, useLiveRefresh } from "../composables/useLiveRefresh";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";
import { useRouter } from "vue-router";

const api = useTraceApi();
const $q = useQuasar();
const f = useFilters();
const router = useRouter();

const goToErrors = () => {
  router.push({ name: "traces", query: { status: "error", range: f.range.value } });
};

const overview = useAsync((signal) => api.getOverview({ ...resolveRange(f.range.value, Date.now()), service: f.service.value }, signal));
async function loadOverview() {
  if (await overview.run()) liveRefresh.touch();
}
const liveRefresh = useLiveRefresh(loadOverview, { isBusy: () => overview.loading.value });
const reload = () => {
  void loadOverview();
};
watch([f.range, f.service], reload, { immediate: true });

const data = computed(() => overview.data.value);
const empty = computed(() => data.value !== null && data.value.totals.traces === 0 && data.value.totals.spans === 0);

const PALETTE = { violet: "#4a32c9", lime: "#c4f26b", limeDeep: "#7fae1f", danger: "#d9382e", amber: "#e39a1b" };

const successRate = computed(() => (data.value ? 1 - data.value.totals.errorRate : 1));
const health = computed(() => {
  const rate = data.value?.totals.errorRate ?? 0;
  if (rate === 0) return { key: "ok", text: "Operación estable" };
  if (rate < 0.05) return { key: "warn", text: "Atención: errores puntuales" };
  return { key: "error", text: "Revisar: errores en ejecuciones" };
});
const tokenSplit = computed(() => {
  const t = data.value?.totals;
  const total = (t?.inputTokens ?? 0) + (t?.outputTokens ?? 0);
  return { input: total ? ((t?.inputTokens ?? 0) / total) * 100 : 0, output: total ? ((t?.outputTokens ?? 0) / total) * 100 : 0 };
});
const tokensPerTrace = computed(() => (data.value && data.value.totals.traces ? data.value.totals.totalTokens / data.value.totals.traces : 0));

const longRange = computed(() => (data.value ? Date.parse(data.value.range.to) - Date.parse(data.value.range.from) > 2 * 86_400_000 : false));
const label = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", longRange.value ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });

function sparkOption(values: number[], color: string): EChartsCoreOption {
  return {
    animationDuration: 400,
    grid: { left: 0, right: 0, top: 4, bottom: 0 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: "value", show: false, min: 0 },
    series: [{ type: "line", data: values, smooth: 0.4, showSymbol: false, lineStyle: { width: 2.5, color }, areaStyle: { color, opacity: 0.22 } }],
  };
}
const traceSpark = computed(() => sparkOption(data.value?.timeseries.map((p) => p.traces) ?? [], PALETTE.violet));

function axisBase() {
  const c = chartColors($q.dark.isActive);
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: c.grid, type: "dashed" as const } },
  };
}
function tooltip() {
  const c = chartColors($q.dark.isActive);
  return {
    trigger: "axis" as const,
    confine: true,
    backgroundColor: "rgba(255,255,255,0.98)",
    textStyle: { color: c.text, fontSize: 12 },
    borderColor: c.grid,
    extraCssText: "box-shadow: 0 12px 32px rgba(14,26,19,0.14); border-radius: 12px;",
  };
}

const activityOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: tooltip(),
    xAxis: { type: "category", data: d?.timeseries.map((p) => label(p.bucketStart)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: [
      { type: "value", minInterval: 1, ...a },
      { type: "value", ...a, splitLine: { show: false }, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatDuration(v) } },
    ],
    series: [
      { name: "Correctas", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.traces - p.errorTraces) ?? [], itemStyle: { color: PALETTE.violet, borderRadius: [0, 0, 0, 0] } },
      { name: "Con error", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.errorTraces) ?? [], itemStyle: { color: PALETTE.purple, borderRadius: [6, 6, 0, 0] } },
      {
        name: "Latencia p95",
        type: "line",
        yAxisIndex: 1,
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: PALETTE.limeDeep },
        data: d?.timeseries.map((p) => p.p95Ms) ?? [],
      },
    ],
  };
});

const inputTokensOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: tooltip(),
    xAxis: { type: "category", boundaryGap: false, data: d?.timeseries.map((p) => label(p.bucketStart)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatCount(v) } },
    series: [
      {
        name: "Tokens de entrada",
        type: "line",
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: PALETTE.violet },
        areaStyle: { color: "rgba(74,50,201,0.16)" },
        data: d?.timeseries.map((p) => Math.round((p.totalTokens * data.value!.totals.inputTokens) / data.value!.totals.totalTokens)) ?? [],
      },
    ],
  };
});

const outputTokensOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: tooltip(),
    xAxis: { type: "category", boundaryGap: false, data: d?.timeseries.map((p) => label(p.bucketStart)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatCount(v) } },
    series: [
      {
        name: "Tokens de salida",
        type: "line",
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: PALETTE.lime },
        areaStyle: { color: "rgba(196,242,107,0.16)" },
        data: d?.timeseries.map((p) => Math.round((p.totalTokens * data.value!.totals.outputTokens) / data.value!.totals.totalTokens)) ?? [],
      },
    ],
  };
});

const latencyByModelOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: tooltip(),
    xAxis: { type: "category", data: d?.byModel.map((m) => m.model.substring(0, 15)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatDuration(v) } },
    series: [
      {
        name: "Latencia p95",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.p95Ms) ?? [],
        itemStyle: { color: PALETTE.violet, borderRadius: [6, 6, 0, 0] },
      },
    ],
  };
});

const toolUsageOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const colors = [PALETTE.violet, PALETTE.amber, PALETTE.danger, PALETTE.limeDeep, "#6c5ce7", "#fd79a8"];
  const total = d?.byTool.reduce((acc, t) => acc + t.calls, 0) ?? 1;
  const toolData = d?.byTool.map((t, i) => {
    const percentage = ((t.calls / total) * 100).toFixed(0);
    return {
      value: t.calls,
      name: `${t.tool} (${percentage}%)`,
      itemStyle: { color: colors[i % colors.length] }
    };
  }) ?? [];

  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(255,255,255,0.98)",
      textStyle: { color: c.text },
      borderColor: c.grid,
      extraCssText: "border-radius: 8px;",
      formatter: "{b}: {c} usos"
    },
    series: [
      {
        name: "Uso de herramientas",
        type: "pie",
        radius: ["40%", "70%"],
        data: toolData,
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0, 0, 0, 0.5)" } },
        label: {
          show: true,
          fontSize: 12,
          fontWeight: 600,
          color: c.text
        }
      },
    ],
  };
});

const inputTokensByModelOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: tooltip(),
    xAxis: { type: "category", data: d?.byModel.map((m) => m.model.substring(0, 15)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatCount(v) } },
    series: [
      {
        name: "Tokens entrada",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.inputTokens) ?? [],
        itemStyle: { color: PALETTE.violet, borderRadius: [6, 6, 0, 0] },
      },
    ],
  };
});

const outputTokensByModelOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: tooltip(),
    xAxis: { type: "category", data: d?.byModel.map((m) => m.model.substring(0, 15)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatCount(v) } },
    series: [
      {
        name: "Tokens salida",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.outputTokens) ?? [],
        itemStyle: { color: PALETTE.lime, borderRadius: [6, 6, 0, 0] },
      },
    ],
  };
});

const maxModelCalls = computed(() => Math.max(1, ...(data.value?.byModel.map((m) => m.calls) ?? [1])));
const maxToolCalls = computed(() => Math.max(1, ...(data.value?.byTool.map((t) => t.calls) ?? [1])));
const pct = (value: number, max: number) => `${Math.max(3, (value / max) * 100)}%`;
const toolErrorRate = (t: { calls: number; errors: number }) => (t.calls ? t.errors / t.calls : 0);
</script>

<template>
  <q-page class="page">
    <header class="head">
      <div>
        <div class="eyebrow">Observabilidad · Resumen ejecutivo</div>
        <h1>Panel de Control</h1>
      </div>
      <FilterBar :range="f.range.value" :loading="overview.loading.value" @update:range="f.setRange" @refresh="reload">
        <LiveControl :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />
      </FilterBar>
    </header>

    <ErrorBanner v-if="overview.error.value" :error="overview.error.value" @retry="reload" />
    <div v-else-if="overview.loading.value && !data" class="loading-box">
      <q-spinner size="32px" color="primary" />
    </div>

    <EmptyState v-else-if="empty" icon="insights" title="Sin datos en este rango">Ejecuta un agente instrumentado o amplía el rango de tiempo.</EmptyState>

    <template v-else-if="data">
      <!-- Summary Overview -->
      <div class="summary-overview">
        <div class="summary-tile">
          <div class="summary-number">{{ formatCount(data.totals.traces) }}</div>
          <div class="summary-text">Ejecuciones</div>
        </div>
        <div class="summary-tile">
          <div class="summary-number">{{ formatCount(data.totals.conversations) }}</div>
          <div class="summary-text">Conversaciones</div>
        </div>
        <div class="summary-tile">
          <div class="summary-number">{{ formatCount(data.totals.spans) }}</div>
          <div class="summary-text">Operaciones</div>
        </div>
      </div>

      <!-- Top Row: Status + Key Metrics -->
      <div class="top-row">
        <div class="status-card" :class="health.key">
          <div class="status-icon"><i /></div>
          <div class="status-body">
            <div class="status-label">ESTADO</div>
            <div class="status-value">{{ formatPercent(successRate) }}</div>
            <div class="status-text">{{ health.text }}</div>
          </div>
          <div class="spark-box">
            <EChart :option="traceSpark" height="72px" label="Tendencia" />
          </div>
        </div>

        <div class="metric-card" :class="{ alert: data.totals.errorTraces > 0 }">
          <div class="metric-label">ERRORES</div>
          <div class="metric-value" :style="{ color: data.totals.errorTraces > 0 ? '#d9b3f0' : '#c4f26b' }">{{ formatCount(data.totals.errorTraces) }}</div>
          <div class="metric-detail">{{ formatPercent(data.totals.errorRate) }}</div>
          <a v-if="data.totals.errorTraces > 0" class="error-link" @click="goToErrors">Ver trazas →</a>
        </div>

        <div class="metric-card">
          <div class="metric-label">LATENCIA P95</div>
          <div class="metric-value" style="color: #e39a1b">{{ formatDuration(data.latencyMs.p95) }}</div>
          <div class="metric-detail">{{ formatDuration(data.latencyMs.p50) }} mediana</div>
        </div>

        <div class="metric-card">
          <div class="metric-label">TOKENS TOTALES</div>
          <div class="metric-value" style="color: #4a32c9">{{ formatCount(data.totals.totalTokens) }}</div>
          <div class="metric-detail">{{ formatCount(Math.round(tokensPerTrace)) }} por exec.</div>
        </div>
      </div>

      <!-- Charts Row - Activity & Tokens -->
      <div class="charts-grid">
        <section class="chart-panel">
          <h2>Actividad y Rendimiento</h2>
          <EChart :option="activityOption" height="400px" label="Ejecuciones, errores y latencia" />
        </section>

        <section class="chart-panel">
          <h2>Distribución de Herramientas</h2>
          <EChart v-if="data.byTool.length" :option="toolUsageOption" height="400px" label="Uso de herramientas" />
          <div v-else class="no-data">Sin herramientas ejecutadas</div>
        </section>
      </div>

      <!-- Tokens Row -->
      <div class="tokens-grid">
        <section class="chart-panel">
          <h2>Tokens de Entrada (Timeseries)</h2>
          <EChart :option="inputTokensOption" height="300px" label="Tokens de entrada" />
        </section>

        <section class="chart-panel">
          <h2>Tokens de Salida (Timeseries)</h2>
          <EChart :option="outputTokensOption" height="300px" label="Tokens de salida" />
        </section>

        <section class="chart-panel">
          <h2>Entrada por Modelo</h2>
          <EChart v-if="data.byModel.length" :option="inputTokensByModelOption" height="300px" label="Tokens entrada por modelo" />
          <div v-else class="no-data">Sin llamadas a LLM</div>
        </section>

        <section class="chart-panel">
          <h2>Salida por Modelo</h2>
          <EChart v-if="data.byModel.length" :option="outputTokensByModelOption" height="300px" label="Tokens salida por modelo" />
          <div v-else class="no-data">Sin llamadas a LLM</div>
        </section>
      </div>

      <!-- Latency Row -->
      <div class="latency-row">
        <section class="chart-panel">
          <h2>Latencia por Modelo</h2>
          <EChart v-if="data.byModel.length" :option="latencyByModelOption" height="300px" label="Latencia p95 por modelo" />
          <div v-else class="no-data">Sin llamadas a LLM</div>
        </section>
      </div>

      <!-- Details Row -->
      <div class="details-grid">
        <section class="detail-panel">
          <div class="panel-header">
            <h3>Modelos de IA</h3>
            <span class="panel-count">{{ data.byModel.length }}</span>
          </div>
          <div v-if="!data.byModel.length" class="empty-state">Sin llamadas a LLM</div>
          <div v-else class="model-grid">
            <div v-for="m in data.byModel" :key="m.model" class="model-card">
              <div class="model-title">{{ m.model }}</div>
              <div class="model-stat-main">
                <div class="model-number">{{ formatCount(m.calls) }}</div>
                <div class="model-label">llamadas</div>
              </div>
              <div class="model-stats-row">
                <div class="model-stat-item">
                  <div class="stat-value">{{ formatCount(m.inputTokens + m.outputTokens) }}</div>
                  <div class="stat-label">tokens</div>
                </div>
                <div class="model-stat-item">
                  <div class="stat-value" style="color: #e39a1b">{{ formatDuration(m.p95Ms) }}</div>
                  <div class="stat-label">latencia p95</div>
                </div>
              </div>
            </div>
          </div>
        </section>


      </div>
    </template>
  </q-page>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  padding: 24px 20px 32px;
  font-family: var(--mt-sans);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 0 4px;
}

.eyebrow {
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.head h1 {
  margin: 4px 0 0;
  font-size: 2rem;
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.loading-box {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 240px;
}

/* Summary Overview */
.summary-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 4px;
}

.summary-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 20px;
  border-radius: 20px;
  background: var(--mt-soft);
  text-align: center;
}

.summary-number {
  font-size: 32px;
  font-weight: 800;
  color: var(--mt-violet);
  line-height: 1;
  letter-spacing: -0.03em;
}

.summary-text {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Top Row */
.top-row {
  display: grid;
  grid-template-columns: 1.8fr 1fr 1fr 1fr;
  gap: 16px;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 28px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
  border-left: 5px solid;
}

.status-card.ok {
  border-left-color: #c4f26b;
}
.status-card.warn {
  border-left-color: #fce4a3;
}
.status-card.error {
  border-left-color: #d9b3f0;
}

.status-icon {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.status-card.ok .status-icon {
  background: rgba(196, 242, 107, 0.12);
}
.status-card.warn .status-icon {
  background: rgba(252, 228, 163, 0.12);
}
.status-card.error .status-icon {
  background: rgba(217, 179, 240, 0.12);
}

.status-icon i {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}

.status-card.ok .status-icon i {
  background: #c4f26b;
}
.status-card.warn .status-icon i {
  background: #fce4a3;
}
.status-card.error .status-icon i {
  background: #d9b3f0;
}

.status-body {
  flex: 1;
}

.status-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--mt-muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.status-value {
  font-size: 48px;
  font-weight: 900;
  color: var(--mt-violet);
  line-height: 1;
  letter-spacing: -0.05em;
  margin-top: 4px;
}

.status-text {
  font-size: 14px;
  color: var(--mt-ink);
  font-weight: 600;
  margin-top: 6px;
}

.spark-box {
  flex-shrink: 0;
  width: 140px;
}

/* Metric Cards */
.metric-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 24px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}

.metric-card.alert {
  border: 2px solid rgba(217, 179, 240, 0.3);
}

.metric-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--mt-muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.metric-value {
  font-size: 42px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.05em;
}

.metric-detail {
  font-size: 12px;
  color: var(--mt-muted);
  font-weight: 600;
}

.error-link {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #d9b3f0;
  cursor: pointer;
  transition: color 0.2s;
  text-decoration: none;
}

.error-link:hover {
  color: #c4a1d9;
  text-decoration: underline;
}

/* Charts Grid */
.charts-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.tokens-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.latency-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.chart-panel {
  padding: 28px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}

.chart-panel.span-2 {
  grid-column: span 1;
}

.chart-panel h2 {
  margin: 0 0 20px 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.02em;
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 380px;
  color: var(--mt-muted);
  font-size: 14px;
  font-weight: 600;
}

/* Details Grid */
.details-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.detail-panel {
  padding: 28px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--mt-soft);
}

.panel-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.02em;
}

.panel-count {
  font-size: 20px;
  font-weight: 800;
  color: var(--mt-violet);
}

.empty-state {
  padding: 32px 0;
  text-align: center;
  color: var(--mt-muted);
  font-size: 13px;
}

/* Model Grid */
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.model-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 16px;
  background: var(--mt-soft);
  border: 2px solid var(--mt-line);
  transition: all 0.2s ease;
}

.model-card:hover {
  border-color: var(--mt-violet);
  box-shadow: 0 4px 12px rgba(74, 50, 201, 0.15);
}

.model-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.model-stat-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-number {
  font-size: 32px;
  font-weight: 900;
  color: var(--mt-violet);
  line-height: 1;
  letter-spacing: -0.04em;
}

.model-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-muted);
}

.model-stats-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--mt-line);
}

.model-stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  font-size: 16px;
  font-weight: 800;
  color: var(--mt-ink);
  line-height: 1;
  letter-spacing: -0.02em;
}

.stat-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* Tool Grid */
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.tool-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 16px;
  background: var(--mt-soft);
  border: 2px solid var(--mt-line);
  transition: all 0.2s ease;
}

.tool-card:hover {
  border-color: var(--mt-violet);
  box-shadow: 0 4px 12px rgba(74, 50, 201, 0.15);
}

.tool-title {
  font-size: 12px;
  font-weight: 800;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tool-status {
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 800;
  text-align: center;
  letter-spacing: 0.08em;
}

.tool-stats-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--mt-line);
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 16px;
  background: var(--mt-soft);
  text-align: center;
}

.summary-value {
  font-size: 32px;
  font-weight: 800;
  color: var(--mt-violet);
  line-height: 1;
  letter-spacing: -0.04em;
}

.summary-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--mt-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

@media (max-width: 1400px) {
  .top-row {
    grid-template-columns: 1.2fr 1fr 1fr 1fr;
  }
  .tokens-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .summary-overview {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 1200px) {
  .top-row {
    grid-template-columns: repeat(2, 1fr);
  }
  .charts-grid {
    grid-template-columns: 1fr;
  }
  .tokens-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .details-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .summary-overview {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .top-row,
  .details-grid,
  .tokens-grid {
    grid-template-columns: 1fr;
  }
  .status-card {
    flex-direction: column;
    text-align: center;
    gap: 16px;
  }
  .spark-box {
    width: 100%;
  }
}
</style>
