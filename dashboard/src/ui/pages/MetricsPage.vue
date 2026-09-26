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

const api = useTraceApi();
const $q = useQuasar();
const f = useFilters();

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
  return { key: "error", text: "Degradado: tasa de error alta" };
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
      { name: "Con error", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.errorTraces) ?? [], itemStyle: { color: PALETTE.danger, borderRadius: [6, 6, 0, 0] } },
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

const tokensOption = computed<EChartsCoreOption>(() => {
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
        name: "Tokens",
        type: "line",
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: PALETTE.violet },
        areaStyle: {
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(74,50,201,0.32)" }, { offset: 1, color: "rgba(74,50,201,0)" }] },
        },
        data: d?.timeseries.map((p) => p.totalTokens) ?? [],
      },
    ],
  };
});

const maxModelCalls = computed(() => Math.max(1, ...(data.value?.byModel.map((m) => m.calls) ?? [1])));
const maxToolCalls = computed(() => Math.max(1, ...(data.value?.byTool.map((t) => t.calls) ?? [1])));
const maxToolP95 = computed(() => Math.max(1, ...(data.value?.byTool.map((t) => t.p95Ms) ?? [1])));
const pct = (value: number, max: number) => `${Math.max(3, (value / max) * 100)}%`;
const toolErrorRate = (t: { calls: number; errors: number }) => (t.calls ? t.errors / t.calls : 0);
</script>

<template>
  <q-page class="page">
    <header class="head">
      <div>
        <div class="eyebrow">Observabilidad · Resumen ejecutivo</div>
        <h1>Métricas</h1>
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
      <!-- KPI Principal: Estado del Sistema -->
      <section class="status-banner" :class="health.key" aria-label="Estado del sistema">
        <div class="status-main">
          <div class="status-icon"><i /></div>
          <div class="status-content">
            <div class="status-title">{{ health.text }}</div>
            <div class="status-desc">{{ formatPercent(successRate) }} de tasa de éxito</div>
          </div>
        </div>
        <div class="status-metrics">
          <div class="status-metric">
            <div class="status-value">{{ formatCount(data.totals.traces - data.totals.errorTraces) }}</div>
            <div class="status-label">Ejecutadas sin error</div>
          </div>
          <div class="status-metric">
            <div class="status-value" :style="{ color: data.totals.errorTraces > 0 ? '#d9382e' : '#2a5a0d' }">{{ formatCount(data.totals.errorTraces) }}</div>
            <div class="status-label">Incidencias</div>
          </div>
        </div>
      </section>

      <!-- KPI Cards - Fila Principal -->
      <section class="kpi-grid" aria-label="Indicadores clave">
        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Ejecuciones</span>
            <span class="kpi-badge">Total</span>
          </div>
          <div class="kpi-value">{{ formatCount(data.totals.traces) }}</div>
          <div class="kpi-subtitle">{{ formatCount(data.totals.spans) }} operaciones</div>
          <div class="kpi-sparkline">
            <EChart :option="traceSpark" height="32px" label="Tendencia de ejecuciones" />
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Latencia p95</span>
            <span class="kpi-badge">Rendimiento</span>
          </div>
          <div class="kpi-value">{{ formatDuration(data.latencyMs.p95) }}</div>
          <div class="kpi-subtitle">{{ formatDuration(data.latencyMs.p50) }} mediana</div>
          <div class="kpi-bar">
            <div class="kpi-bar-fill" :style="{
              width: Math.min(100, (data.latencyMs.p95 / Math.max(data.latencyMs.p95, data.latencyMs.p99 * 1.2)) * 100) + '%',
              backgroundColor: data.latencyMs.p95 < 1000 ? '#7fae1f' : data.latencyMs.p95 < 3000 ? '#e39a1b' : '#d9382e'
            }" />
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Tokens consumidos</span>
            <span class="kpi-badge">Coste</span>
          </div>
          <div class="kpi-value">{{ formatCount(data.totals.totalTokens) }}</div>
          <div class="kpi-subtitle">{{ formatCount(Math.round(tokensPerTrace)) }} por ejecución</div>
          <div class="kpi-split">
            <div class="kpi-split-item">
              <div class="kpi-split-bar">
                <div class="kpi-split-fill" :style="{ width: `${tokenSplit.input}%`, backgroundColor: '#4a32c9' }" />
              </div>
              <div class="kpi-split-label">{{ formatPercent(tokenSplit.input / 100) }} entrada</div>
            </div>
            <div class="kpi-split-item">
              <div class="kpi-split-bar">
                <div class="kpi-split-fill" :style="{ width: `${tokenSplit.output}%`, backgroundColor: '#c4f26b' }" />
              </div>
              <div class="kpi-split-label">{{ formatPercent(tokenSplit.output / 100) }} salida</div>
            </div>
          </div>
        </div>

        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Conversaciones</span>
            <span class="kpi-badge">Usuarios</span>
          </div>
          <div class="kpi-value">{{ formatCount(data.totals.conversations) }}</div>
          <div class="kpi-subtitle">usuarios atendidos</div>
          <div style="flex: 1;" />
        </div>
      </section>

      <!-- Gráficos -->
      <div class="grid">
        <section class="mt-card panel span-2">
          <div class="panel-head">
            <div>
              <h2>Volumen y rendimiento</h2>
              <p>Ejecuciones por intervalo, incidencias y latencia p95</p>
            </div>
            <div class="legend">
              <span><i style="background: #4a32c9" />Correctas</span>
              <span><i style="background: #d9382e" />Con error</span>
              <span><i style="background: #7fae1f" />Latencia p95</span>
            </div>
          </div>
          <EChart :option="activityOption" height="320px" label="Ejecuciones por intervalo y latencia p95" />
        </section>

        <section class="mt-card panel">
          <div class="panel-head">
            <div>
              <h2>Consumo de tokens</h2>
              <p>Evolución en el rango seleccionado</p>
            </div>
          </div>
          <EChart :option="tokensOption" height="320px" label="Tokens consumidos por intervalo" />
        </section>

        <section class="mt-card panel">
          <div class="panel-head">
            <div>
              <h2>Modelos</h2>
              <p>Uso y coste en tokens</p>
            </div>
          </div>
          <div v-if="!data.byModel.length" class="none">Sin llamadas a LLM</div>
          <ul v-else class="rank">
            <li v-for="m in data.byModel" :key="m.model">
              <div class="rank-top">
                <span class="rank-name mono">{{ m.model }}</span>
                <span class="rank-num">{{ formatCount(m.calls) }} <small>llamadas</small></span>
              </div>
              <div class="bar"><i :style="{ width: pct(m.calls, maxModelCalls) }" /></div>
              <div class="rank-meta">
                <span>{{ formatCount(m.inputTokens + m.outputTokens) }} tokens</span>
                <span>p95 {{ formatDuration(m.p95Ms) }}</span>
              </div>
            </li>
          </ul>
        </section>

        <section class="mt-card panel span-2">
          <div class="panel-head">
            <div>
              <h2>Herramientas</h2>
              <p>Fiabilidad y tiempo de respuesta de cada herramienta</p>
            </div>
          </div>
          <div v-if="!data.byTool.length" class="none">Sin herramientas ejecutadas</div>
          <table v-else class="tools">
            <thead>
              <tr>
                <th>Herramienta</th>
                <th>Uso</th>
                <th class="r">Errores</th>
                <th>Latencia p95</th>
                <th class="r">Estado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in data.byTool" :key="t.tool">
                <td class="mono name">{{ t.tool }}</td>
                <td>
                  <div class="cell-bar"><div class="bar"><i :style="{ width: pct(t.calls, maxToolCalls) }" /></div><span>{{ formatCount(t.calls) }}</span></div>
                </td>
                <td class="r">{{ formatCount(t.errors) }}</td>
                <td>
                  <div class="cell-bar"><div class="bar soft"><i :style="{ width: pct(t.p95Ms, maxToolP95) }" /></div><span>{{ formatDuration(t.p95Ms) }}</span></div>
                </td>
                <td class="r">
                  <span class="mt-pill" :class="toolErrorRate(t) === 0 ? 'ok' : toolErrorRate(t) < 0.1 ? 'warn' : 'error'">
                    {{ toolErrorRate(t) === 0 ? "Fiable" : formatPercent(toolErrorRate(t)) + " fallos" }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
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
  gap: 24px;
  max-width: 1320px;
  margin: 0 auto;
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

/* Status Banner - Estado del Sistema */
.status-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 28px;
  border-radius: 28px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}

.status-banner.ok {
  border-left: 6px solid #2a5a0d;
}
.status-banner.warn {
  border-left: 6px solid #e39a1b;
}
.status-banner.error {
  border-left: 6px solid #d9382e;
}

.status-main {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
  min-width: 0;
}

.status-icon {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.status-banner.ok .status-icon {
  background: rgba(42, 90, 13, 0.15);
}
.status-banner.warn .status-icon {
  background: rgba(227, 154, 27, 0.15);
}
.status-banner.error .status-icon {
  background: rgba(217, 56, 46, 0.15);
}

.status-icon i {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: block;
}

.status-banner.ok .status-icon i {
  background: #2a5a0d;
  box-shadow: 0 0 0 8px rgba(42, 90, 13, 0.1);
}
.status-banner.warn .status-icon i {
  background: #e39a1b;
  box-shadow: 0 0 0 8px rgba(227, 154, 27, 0.1);
}
.status-banner.error .status-icon i {
  background: #d9382e;
  box-shadow: 0 0 0 8px rgba(217, 56, 46, 0.1);
}

.status-content {
  flex: 1;
}

.status-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.02em;
}

.status-desc {
  margin-top: 4px;
  font-size: 14px;
  color: var(--mt-muted);
}

.status-metrics {
  display: flex;
  gap: 32px;
  flex-shrink: 0;
}

.status-metric {
  text-align: right;
}

.status-value {
  font-size: 28px;
  font-weight: 700;
  color: #2a5a0d;
  line-height: 1;
  letter-spacing: -0.03em;
}

.status-label {
  margin-top: 6px;
  font-size: 12px;
  color: var(--mt-muted);
  font-weight: 600;
}

/* KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.kpi-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}

.kpi-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kpi-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-muted);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.kpi-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 12px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.kpi-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--mt-violet);
  line-height: 1;
  letter-spacing: -0.04em;
}

.kpi-subtitle {
  font-size: 12px;
  color: var(--mt-muted);
  font-weight: 500;
}

.kpi-sparkline {
  margin: 8px -4px 0;
}

.kpi-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--mt-soft);
  margin-top: 6px;
}

.kpi-bar-fill {
  flex-grow: 1;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.kpi-split {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kpi-split-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-split-bar {
  display: flex;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--mt-soft);
}

.kpi-split-fill {
  flex-grow: 1;
  border-radius: 2px;
}

.kpi-split-label {
  font-size: 11px;
  color: var(--mt-muted);
  font-weight: 600;
}

/* Panels */
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 8px;
}
.span-2 {
  grid-column: span 2;
}
.panel {
  box-sizing: border-box;
  min-width: 0;
  padding: 24px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.panel h2 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.03em;
  font-weight: 700;
  color: var(--mt-ink);
}
.panel p {
  margin: 6px 0 0;
  color: var(--mt-muted);
  font-size: 13px;
  font-weight: 500;
}
.legend {
  display: flex;
  gap: 14px;
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 600;
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.legend i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.none {
  padding: 40px 0;
  color: var(--mt-faint);
  font-size: 13px;
  text-align: center;
}

/* Ranking de modelos */
.rank {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.rank-top,
.rank-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.rank-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
  color: var(--mt-ink);
}
.rank-num {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  color: var(--mt-violet);
}
.rank-num small {
  color: var(--mt-muted);
  font-weight: 500;
  font-size: 11px;
  margin-left: 4px;
}
.rank-meta {
  margin-top: 8px;
  color: var(--mt-muted);
  font-size: 12px;
  display: flex;
  gap: 16px;
}
.bar {
  height: 6px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--mt-soft);
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--mt-violet);
}
.bar.soft i {
  background: #c4a9f0;
}

/* Tabla de herramientas */
.tools {
  width: 100%;
  border-collapse: collapse;
}
.tools th {
  padding: 0 12px 12px;
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-align: left;
  text-transform: uppercase;
  border-bottom: 1px solid var(--mt-line);
}
.tools td {
  padding: 14px 12px;
  font-size: 13px;
  border-bottom: 1px solid var(--mt-line-2);
}
.tools tbody tr:last-child td {
  border-bottom: 0;
}
.tools tbody tr:hover {
  background: var(--mt-soft);
}
.tools .r {
  text-align: right;
}
.tools .name {
  font-weight: 700;
  color: var(--mt-ink);
}
.cell-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 140px;
}
.cell-bar .bar {
  flex: 1;
  margin-top: 0;
}
.cell-bar span {
  min-width: 48px;
  font-weight: 700;
  text-align: right;
  color: var(--mt-violet);
}

@media (max-width: 1200px) {
  .status-banner {
    flex-direction: column;
    align-items: flex-start;
    gap: 20px;
  }
  .status-metrics {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: auto;
  }
}

@media (max-width: 768px) {
  .status-metrics {
    flex-direction: column;
    gap: 16px;
  }
  .status-metric {
    text-align: left;
  }
  .kpi-grid {
    grid-template-columns: 1fr;
  }
  .page {
    gap: 16px;
  }
}
</style>
