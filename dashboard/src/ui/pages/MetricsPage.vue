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
      <section class="hero" aria-label="Indicadores principales">
        <div class="hero-main">
          <div class="hero-top">
            <span class="hero-label">Tasa de éxito</span>
            <span class="health" :class="health.key"><i />{{ health.text }}</span>
          </div>
          <div class="hero-value">{{ formatPercent(successRate) }}</div>
          <div class="hero-sub">{{ formatCount(data.totals.traces - data.totals.errorTraces) }} de {{ formatCount(data.totals.traces) }} ejecuciones completadas sin error</div>
          <div class="hero-spark">
            <EChart :option="traceSpark" height="84px" label="Tendencia de ejecuciones" />
          </div>
        </div>

        <div class="hero-side">
          <div class="metric">
            <span>Ejecuciones</span>
            <strong>{{ formatCount(data.totals.traces) }}</strong>
            <small>{{ formatCount(data.totals.spans) }} operaciones</small>
          </div>
          <div class="metric">
            <span>Conversaciones</span>
            <strong>{{ formatCount(data.totals.conversations) }}</strong>
            <small>usuarios atendidos</small>
          </div>
          <div class="metric">
            <span>Tiempo de respuesta p95</span>
            <strong>{{ formatDuration(data.latencyMs.p95) }}</strong>
            <small>el 95 % responde en menos</small>
          </div>
          <div class="metric" :class="{ bad: data.totals.errorTraces > 0 }">
            <span>Incidencias</span>
            <strong>{{ formatCount(data.totals.errorTraces) }}</strong>
            <small>{{ formatPercent(data.totals.errorRate) }} de las ejecuciones</small>
          </div>
        </div>
      </section>

      <section class="strip mt-card" aria-label="Rendimiento y consumo">
        <div class="strip-cell">
          <span>Latencia mediana</span>
          <strong>{{ formatDuration(data.latencyMs.p50) }}</strong>
        </div>
        <div class="strip-cell">
          <span>Latencia p99</span>
          <strong>{{ formatDuration(data.latencyMs.p99) }}</strong>
        </div>
        <div class="strip-cell">
          <span>Tokens totales</span>
          <strong>{{ formatCount(data.totals.totalTokens) }}</strong>
        </div>
        <div class="strip-cell">
          <span>Tokens por ejecución</span>
          <strong>{{ formatCount(Math.round(tokensPerTrace)) }}</strong>
        </div>
        <div class="strip-cell wide">
          <span>Entrada / salida</span>
          <div class="split" role="img" :aria-label="`${formatCount(data.totals.inputTokens)} de entrada, ${formatCount(data.totals.outputTokens)} de salida`">
            <i class="in" :style="{ width: `${tokenSplit.input}%` }" />
            <i class="out" :style="{ width: `${tokenSplit.output}%` }" />
          </div>
          <small>{{ formatCount(data.totals.inputTokens) }} entrada · {{ formatCount(data.totals.outputTokens) }} salida</small>
        </div>
      </section>

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
  gap: 16px;
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

/* Hero */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 16px;
}
.hero-main {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 26px 28px 0;
  border-radius: 28px;
  color: var(--mt-ink);
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}
.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.hero-label {
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.health {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--mt-soft);
  color: var(--mt-ink);
  font-size: 12px;
  font-weight: 600;
}
.health i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4fa01e;
  box-shadow: 0 0 0 4px rgba(79, 160, 30, 0.18);
}
.health.warn i { background: #f6b73c; box-shadow: 0 0 0 4px rgba(246, 183, 60, 0.2); }
.health.error i { background: #ff6b5e; box-shadow: 0 0 0 4px rgba(255, 107, 94, 0.2); }
.hero-value {
  margin-top: 18px;
  font-size: clamp(3rem, 6vw, 4.6rem);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.06em;
  color: var(--mt-violet);
}
.hero-sub {
  margin-top: 10px;
  color: var(--mt-muted);
  font-size: 13px;
}
.hero-spark {
  margin: 18px -28px 0;
}
.hero-side {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  padding: 18px 20px;
  border-radius: 24px;
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}
.metric span,
.strip-cell span {
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 600;
}
.metric strong {
  font-size: clamp(1.6rem, 2.6vw, 2.2rem);
  line-height: 1;
  letter-spacing: -0.05em;
}
.metric small,
.strip-cell small {
  color: var(--mt-faint);
  font-size: 12px;
}
.metric.bad strong {
  color: var(--mt-err-ink);
}

/* Strip */
.strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.6fr);
  padding: 6px 0;
}
.strip-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 22px;
  border-left: 1px solid var(--mt-line);
}
.strip-cell:first-child {
  border-left: 0;
}
.strip-cell strong {
  font-size: 1.35rem;
  line-height: 1.1;
  letter-spacing: -0.04em;
}
.split {
  display: flex;
  height: 10px;
  margin: 6px 0 2px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--mt-soft);
}
.split .in { background: var(--mt-violet); }
.split .out { background: var(--mt-accent); }

/* Panels */
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.span-2 {
  grid-column: span 2;
}
.panel {
  box-sizing: border-box;
  min-width: 0;
  padding: 22px 22px 18px;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.panel h2 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.03em;
}
.panel p {
  margin: 4px 0 0;
  color: var(--mt-muted);
  font-size: 12.5px;
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
  padding: 28px 0;
  color: var(--mt-faint);
  font-size: 13px;
  text-align: center;
}

/* Ranking de modelos */
.rank {
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  font-weight: 600;
}
.rank-num {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
}
.rank-num small {
  color: var(--mt-faint);
  font-weight: 500;
  font-size: 11px;
}
.rank-meta {
  margin-top: 6px;
  color: var(--mt-muted);
  font-size: 12px;
}
.bar {
  height: 8px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--mt-soft);
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--mt-violet);
}
.bar.soft i {
  background: #a99be8;
}

/* Tabla de herramientas */
.tools {
  width: 100%;
  border-collapse: collapse;
}
.tools th {
  padding: 0 10px 10px;
  color: var(--mt-faint);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-align: left;
  text-transform: uppercase;
  border-bottom: 1px solid var(--mt-line);
}
.tools td {
  padding: 13px 10px;
  font-size: 13px;
  border-bottom: 1px solid var(--mt-line-2);
}
.tools tbody tr:last-child td {
  border-bottom: 0;
}
.tools tbody tr:hover {
  background: var(--mt-soft-2);
}
.tools .r {
  text-align: right;
}
.tools .name {
  font-weight: 600;
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
  font-weight: 600;
  text-align: right;
}

@media (max-width: 1100px) {
  .hero,
  .grid {
    grid-template-columns: 1fr;
  }
  .span-2 {
    grid-column: auto;
  }
  .strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .strip-cell {
    border-left: 0;
  }
  .strip-cell.wide {
    grid-column: span 2;
  }
}
@media (max-width: 600px) {
  .hero-side {
    grid-template-columns: 1fr;
  }
}
</style>
