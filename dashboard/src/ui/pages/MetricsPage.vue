<script setup lang="ts">
import type { EChartsCoreOption } from "echarts/core";
import { computed, ref, watch } from "vue";
import { chartColors } from "../chart-theme";
import { formatCostUsd, formatCount, formatDuration, formatPercent } from "@/domain/format";
import { resolveRange } from "@/domain/time-range";
import { useQuasar } from "quasar";
import CustomChartsPanel from "../components/CustomChartsPanel.vue";
import MetricReportView from "../components/MetricReportView.vue";
import EChart from "../components/EChart.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import PageHeader from "../components/PageHeader.vue";
import Select from "../components/Select.vue";
import { useAsync } from "../composables/useAsync";
import { setRefreshSeconds, useLiveRefresh } from "../composables/useLiveRefresh";
import { useFilters } from "../composables/useFilters";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import { useRoute, useRouter } from "vue-router";

const api = useTraceApi();
const identityApi = useIdentityApi();
const $q = useQuasar();
const f = useFilters();
const router = useRouter();
const route = useRoute();
const experimentId = computed(() => route.params.experimentId as string);

const experiments = useAsync((signal) => identityApi.listExperiments(signal));
void experiments.run();

const agentOptions = computed(() => (experiments.data.value ?? []).map((e) => ({ label: e.name, value: e.id })));
const selectAgent = (id: string) => {
  if (id !== experimentId.value) router.push({ name: "metrics", params: { experimentId: id }, query: { range: f.range.value } });
};

const goToErrors = () => {
  router.push({ name: "conversations", params: { experimentId: experimentId.value }, query: { status: "error", range: f.range.value } });
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
const customChartsRange = computed(() => resolveRange(f.range.value, Date.now()));
const empty = computed(() => data.value !== null && data.value.totals.traces === 0 && data.value.totals.spans === 0);


const successRate = computed(() => (data.value ? 1 - data.value.totals.errorRate : 1));
const health = computed(() => {
  const rate = data.value?.totals.errorRate ?? 0;
  if (rate === 0) return { key: "ok", text: "Stable operation" };
  if (rate < 0.05) return { key: "warn", text: "Warning: Occasional errors" };
  return { key: "error", text: "Alert: Errors in executions" };
});
const tokenSplit = computed(() => {
  const t = data.value?.totals;
  const total = (t?.inputTokens ?? 0) + (t?.outputTokens ?? 0);
  return { input: total ? ((t?.inputTokens ?? 0) / total) * 100 : 0, output: total ? ((t?.outputTokens ?? 0) / total) * 100 : 0 };
});
const tokensPerTrace = computed(() => (data.value && data.value.totals.traces ? data.value.totals.totalTokens / data.value.totals.traces : 0));
const costPerTrace = computed(() => (data.value && data.value.totals.traces ? data.value.totals.costUsd / data.value.totals.traces : 0));

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
const traceSpark = computed(() => sparkOption(data.value?.timeseries.map((p) => p.traces) ?? [], chartColors($q.dark.isActive).primary));

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
    backgroundColor: $q.dark.isActive ? "rgba(22,34,26,0.98)" : "rgba(255,255,255,0.98)",
    textStyle: { color: c.text, fontSize: 12 },
    borderColor: c.grid,
    extraCssText: "box-shadow: 0 12px 32px rgba(14,26,19,0.14); border-radius: var(--mt-radius-lg);",
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
      { name: "Successful", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.traces - p.errorTraces) ?? [], itemStyle: { color: c.primary, borderRadius: [0, 0, 0, 0] } },
      { name: "With errors", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.errorTraces) ?? [], itemStyle: { color: c.danger, borderRadius: [6, 6, 0, 0] } },
      {
        name: "Latency p95",
        type: "line",
        yAxisIndex: 1,
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: c.series[2] },
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
        name: "Input tokens",
        type: "line",
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: c.primary },
        areaStyle: { color: c.primary, opacity: 0.14 },
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
        name: "Output tokens",
        type: "line",
        smooth: 0.35,
        showSymbol: false,
        lineStyle: { width: 2.5, color: c.primary },
        areaStyle: { color: c.primary, opacity: 0.14 },
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
        name: "Latency p95",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.p95Ms) ?? [],
        itemStyle: { color: c.primary, borderRadius: [6, 6, 0, 0] },
      },
    ],
  };
});

const toolUsageOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const colors = c.series;
  const total = d?.byTool.reduce((acc, t) => acc + t.calls, 0) ?? 1;
  const toolData = d?.byTool.map((t, i) => {
    const errorRate = t.calls ? ((t.errors / t.calls) * 100).toFixed(0) : 0;
    return {
      value: t.calls,
      name: t.tool,
      errors: t.errors,
      errorRate: errorRate,
      itemStyle: { color: colors[i % colors.length] }
    };
  }) ?? [];

  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    tooltip: {
      trigger: "item",
      backgroundColor: $q.dark.isActive ? "rgba(22,34,26,0.98)" : "rgba(255,255,255,0.98)",
      textStyle: { color: c.text },
      borderColor: c.grid,
      extraCssText: "border-radius: var(--mt-radius-sm);",
      formatter: (param: any) => {
        if (param.data) {
          const percentage = ((param.value / total) * 100).toFixed(0);
          return `<strong>${param.name}</strong><br/>Uses: ${param.value} (${percentage}%)<br/>Failures: ${param.data.errors} (${param.data.errorRate}%)`;
        }
        return '';
      }
    },
    series: [
      {
        name: "Tool usage",
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
        name: "Input tokens",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.inputTokens) ?? [],
        itemStyle: { color: c.primary, borderRadius: [6, 6, 0, 0] },
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
        name: "Output tokens",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.outputTokens) ?? [],
        itemStyle: { color: c.series[2], borderRadius: [6, 6, 0, 0] },
      },
    ],
  };
});

const costByModelOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 520,
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: { ...tooltip(), valueFormatter: (v: unknown) => formatCostUsd(typeof v === "number" ? v : 0) ?? "–" },
    xAxis: { type: "category", data: d?.byModel.map((m) => m.model.substring(0, 15)) ?? [], ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: { ...a.axisLabel, formatter: (v: number) => formatCostUsd(v) ?? "–" } },
    series: [
      {
        name: "Cost",
        type: "bar",
        barMaxWidth: 40,
        data: d?.byModel.map((m) => m.costUsd ?? 0) ?? [],
        itemStyle: { color: c.series[3] ?? c.primary, borderRadius: [6, 6, 0, 0] },
      },
    ],
  };
});

const topicUsageOption = computed<EChartsCoreOption>(() => {
  const d = data.value;
  const c = chartColors($q.dark.isActive);
  const colors = c.series;
  const total = d?.byTopic.reduce((acc, t) => acc + t.responses, 0) ?? 1;
  const topicData =
    d?.byTopic.map((t, i) => ({
      value: t.responses,
      name: t.topic,
      avgConfidence: (t.avgConfidence * 100).toFixed(0),
      itemStyle: { color: colors[i % colors.length] },
    })) ?? [];

  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    tooltip: {
      trigger: "item",
      backgroundColor: $q.dark.isActive ? "rgba(22,34,26,0.98)" : "rgba(255,255,255,0.98)",
      textStyle: { color: c.text },
      borderColor: c.grid,
      extraCssText: "border-radius: var(--mt-radius-sm);",
      formatter: (param: any) => {
        if (param.data) {
          const percentage = ((param.value / total) * 100).toFixed(0);
          return `<strong>${param.name}</strong><br/>Responses: ${param.value} (${percentage}%)<br/>Avg. confidence: ${param.data.avgConfidence}%`;
        }
        return "";
      },
    },
    series: [
      {
        name: "Topics",
        type: "pie",
        radius: ["40%", "70%"],
        data: topicData,
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: "rgba(0, 0, 0, 0.5)" } },
        label: { show: true, fontSize: 12, fontWeight: 600, color: c.text },
      },
    ],
  };
});

const maxModelCalls = computed(() => Math.max(1, ...(data.value?.byModel.map((m) => m.calls) ?? [1])));
const maxToolCalls = computed(() => Math.max(1, ...(data.value?.byTool.map((t) => t.calls) ?? [1])));
const toolErrorRate = (t: { calls: number; errors: number }) => (t.calls ? t.errors / t.calls : 0);

// ---- Pestañas de la página: Overview / Compare / Custom charts / un informe guardado por pestaña ----
const activeTab = ref<string>("overview");

// ---- Informes guardados (ADR-033): una pestaña dinámica por informe, más "+" para crear uno nuevo ----
const reports = useAsync((signal) => identityApi.listMetricReports(experimentId.value, signal));
watch(
  experimentId,
  () => {
    activeTab.value = "overview";
    void reports.run();
  },
  { immediate: true },
);

const reportTabName = (id: string) => `report:${id}`;
const reportIdFromTab = (tab: string) => (tab.startsWith("report:") ? tab.slice("report:".length) : null);

const creatingReport = ref(false);
const newReportName = ref("");
const creatingReportBusy = ref(false);

function openCreateReport() {
  newReportName.value = "";
  creatingReport.value = true;
}

async function createReport() {
  if (!newReportName.value.trim()) return;
  creatingReportBusy.value = true;
  try {
    const created = await identityApi.createMetricReport(experimentId.value, newReportName.value.trim());
    await reports.run();
    activeTab.value = reportTabName(created.id);
    creatingReport.value = false;
  } finally {
    creatingReportBusy.value = false;
  }
}

function onReportRenamed(reportId: string, name: string) {
  const item = reports.data.value?.find((r) => r.id === reportId);
  if (item) item.name = name;
}

function onReportDeleted() {
  activeTab.value = "overview";
  void reports.run();
}

// ---- Comparativa entre 2 agentes (superpuesta sobre el mismo rango) ----
const compareAgentId = ref<string | null>(null);
const compareOptions = computed(() => agentOptions.value.filter((o) => o.value !== experimentId.value));
const agentAName = computed(() => experiments.data.value?.find((e) => e.id === experimentId.value)?.name ?? "This agent");
const agentBName = computed(() => experiments.data.value?.find((e) => e.id === compareAgentId.value)?.name ?? "Agent B");

const compareB = useAsync((signal) => api.getOverviewForExperiment(compareAgentId.value as string, resolveRange(f.range.value, Date.now()), signal));
function loadCompare() {
  if (activeTab.value === "compare" && compareAgentId.value) void compareB.run();
}
watch([f.range, compareAgentId, activeTab], loadCompare);
const compareData = computed(() => compareB.data.value);

watch(activeTab, (tab) => {
  if (tab === "compare" && !compareAgentId.value) compareAgentId.value = compareOptions.value[0]?.value ?? null;
});

const compareRows = computed(() => {
  const a = data.value;
  const b = compareData.value;
  if (!a || !b) return [];
  return [
    { label: "Executions", a: formatCount(a.totals.traces), b: formatCount(b.totals.traces) },
    { label: "Conversations", a: formatCount(a.totals.conversations), b: formatCount(b.totals.conversations) },
    { label: "Operations", a: formatCount(a.totals.spans), b: formatCount(b.totals.spans) },
    { label: "Error rate", a: formatPercent(a.totals.errorRate), b: formatPercent(b.totals.errorRate) },
    { label: "Latency p50", a: formatDuration(a.latencyMs.p50), b: formatDuration(b.latencyMs.p50) },
    { label: "Latency p95", a: formatDuration(a.latencyMs.p95), b: formatDuration(b.latencyMs.p95) },
    { label: "Latency p99", a: formatDuration(a.latencyMs.p99), b: formatDuration(b.latencyMs.p99) },
    { label: "Total tokens", a: formatCount(a.totals.totalTokens), b: formatCount(b.totals.totalTokens) },
    { label: "Input tokens", a: formatCount(a.totals.inputTokens), b: formatCount(b.totals.inputTokens) },
    { label: "Output tokens", a: formatCount(a.totals.outputTokens), b: formatCount(b.totals.outputTokens) },
    { label: "Total cost", a: formatCostUsd(a.totals.costUsd) ?? "–", b: formatCostUsd(b.totals.costUsd) ?? "–" },
  ];
});

const compareLabels = computed(() => data.value?.timeseries.map((p) => label(p.bucketStart)) ?? []);
function compareLineOption(aValues: number[], bValues: number[], valueFormatter?: (v: number) => string): EChartsCoreOption {
  const c = chartColors($q.dark.isActive);
  const a = axisBase();
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 400,
    grid: { left: 6, right: 6, top: 34, bottom: 6, containLabel: true },
    legend: { data: [agentAName.value, agentBName.value], top: 0, textStyle: { color: c.text, fontSize: 11 } },
    tooltip: tooltip(),
    xAxis: { type: "category", boundaryGap: false, data: compareLabels.value, ...a, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...a, axisLabel: valueFormatter ? { ...a.axisLabel, formatter: (v: number) => valueFormatter(v) } : a.axisLabel },
    series: [
      { name: agentAName.value, type: "line", smooth: 0.35, showSymbol: false, lineStyle: { width: 2.5, color: c.primary }, data: aValues },
      { name: agentBName.value, type: "line", smooth: 0.35, showSymbol: false, lineStyle: { width: 2.5, color: c.series[2], type: "dashed" }, data: bValues },
    ],
  };
}
const compareActivityOption = computed<EChartsCoreOption>(() =>
  compareLineOption(data.value?.timeseries.map((p) => p.traces) ?? [], compareData.value?.timeseries.map((p) => p.traces) ?? []),
);
const compareTokensOption = computed<EChartsCoreOption>(() =>
  compareLineOption(data.value?.timeseries.map((p) => p.totalTokens) ?? [], compareData.value?.timeseries.map((p) => p.totalTokens) ?? [], formatCount),
);
const compareLatencyOption = computed<EChartsCoreOption>(() =>
  compareLineOption(data.value?.timeseries.map((p) => p.p95Ms) ?? [], compareData.value?.timeseries.map((p) => p.p95Ms) ?? [], formatDuration),
);
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="[{ label: 'MemTrace', to: { name: 'conversations', params: { experimentId } } }, { label: 'Metrics' }]" icon="M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" title="Metrics">
      <FilterBar :range="f.range.value" :loading="overview.loading.value" @update:range="f.setRange" @refresh="reload">
        <div class="agent-select">
          <Select :model-value="experimentId" :options="agentOptions" :loading="experiments.loading.value" placeholder="Select agent" @update:model-value="selectAgent" />
        </div>
        <LiveControl :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />
      </FilterBar>
    </PageHeader>

    <div class="metrics-tabs-row">
      <q-tabs v-model="activeTab" class="metrics-tabs" active-color="primary" indicator-color="primary" align="left" no-caps dense>
        <q-tab name="overview" label="Overview" />
        <q-tab name="compare" label="Compare" :disable="(experiments.data.value?.length ?? 0) < 2" />
        <q-tab name="custom" label="Custom charts" />
        <q-tab v-for="r in reports.data.value ?? []" :key="r.id" :name="reportTabName(r.id)" :label="r.name" />
      </q-tabs>
      <button type="button" class="add-report-btn" title="New report" @click="openCreateReport">+ New report</button>
    </div>

    <q-dialog v-model="creatingReport">
      <q-card class="create-report-card">
        <q-card-section>
          <div class="create-report-title">New report</div>
          <input v-model="newReportName" class="text-input" placeholder="Report name" @keyup.enter="createReport" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Cancel" @click="creatingReport = false" />
          <q-btn unelevated no-caps color="primary" label="Create" :disable="!newReportName.trim()" :loading="creatingReportBusy" @click="createReport" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-tab-panels v-model="activeTab" animated keep-alive class="metrics-tab-panels">
      <q-tab-panel name="overview" class="metrics-tab-panel">
        <ErrorBanner v-if="overview.error.value" :error="overview.error.value" @retry="reload" />
        <div v-else-if="overview.loading.value && !data" class="loading-box">
          <q-spinner size="32px" color="primary" />
        </div>

        <EmptyState v-else-if="empty" icon="insights" title="No data in this range">Run an instrumented agent or extend the time range.</EmptyState>

        <template v-else-if="data">
          <!-- Summary Overview -->
          <div class="summary-overview">
            <div class="summary-tile">
              <div class="summary-number">{{ formatCount(data.totals.traces) }}</div>
              <div class="summary-text">Executions</div>
            </div>
            <div class="summary-tile">
              <div class="summary-number">{{ formatCount(data.totals.conversations) }}</div>
              <div class="summary-text">Conversations</div>
            </div>
            <div class="summary-tile">
              <div class="summary-number">{{ formatCount(data.totals.spans) }}</div>
              <div class="summary-text">Operations</div>
            </div>
          </div>

          <!-- Top Row: Status + Key Metrics -->
          <div class="top-row">
            <div class="status-card" :class="health.key">
              <div class="status-icon"><i /></div>
              <div class="status-body">
                <div class="status-label">STATUS</div>
                <div class="status-value">{{ formatPercent(successRate) }}</div>
                <div class="status-text">{{ health.text }}</div>
              </div>
              <div class="spark-box">
                <EChart :option="traceSpark" height="72px" label="Trend" />
              </div>
            </div>

            <div class="metric-card" :class="{ alert: data.totals.errorTraces > 0 }">
              <div class="metric-label">ERRORS</div>
              <div class="metric-value-with-icon">
                <q-icon v-if="data.totals.errorTraces > 0" name="error" size="20px" color="var(--mt-err-ink)" />
                <div :style="{ color: data.totals.errorTraces > 0 ? 'var(--mt-err-ink)' : 'var(--mt-accent)' }">{{ formatCount(data.totals.errorTraces) }}</div>
              </div>
              <div class="metric-detail">{{ formatPercent(data.totals.errorRate) }}</div>
              <a v-if="data.totals.errorTraces > 0" class="error-link" @click="goToErrors">View traces →</a>
            </div>

            <div class="metric-card">
              <div class="metric-label">LATENCY P95</div>
              <div class="metric-value" style="color: var(--mt-accent)">{{ formatDuration(data.latencyMs.p95) }}</div>
              <div class="metric-detail">{{ formatDuration(data.latencyMs.p50) }} median</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">TOTAL TOKENS</div>
              <div class="metric-value" style="color: var(--mt-accent)">{{ formatCount(data.totals.totalTokens) }}</div>
              <div class="metric-detail">{{ formatCount(Math.round(tokensPerTrace)) }} per exec.</div>
            </div>

            <div class="metric-card">
              <div class="metric-label">TOTAL COST</div>
              <div class="metric-value" style="color: var(--mt-accent)">{{ formatCostUsd(data.totals.costUsd) }}</div>
              <div class="metric-detail">{{ formatCostUsd(costPerTrace) }} per exec.</div>
            </div>
          </div>

          <!-- Charts Row - Activity & Tokens -->
          <div class="charts-grid">
            <section class="chart-panel">
              <h2>Activity and Performance</h2>
              <EChart :option="activityOption" height="400px" label="Executions, errors, and latency" />
            </section>

            <section class="chart-panel">
              <h2>Tool Distribution</h2>
              <EChart v-if="data.byTool.length" :option="toolUsageOption" height="400px" label="Tool usage" />
              <div v-else class="no-data">No tools executed</div>
            </section>
          </div>

          <!-- Tokens Row -->
          <div class="tokens-grid">
            <section class="chart-panel">
              <h2>Input Tokens (Timeseries)</h2>
              <EChart :option="inputTokensOption" height="300px" label="Input tokens" />
            </section>

            <section class="chart-panel">
              <h2>Output Tokens (Timeseries)</h2>
              <EChart :option="outputTokensOption" height="300px" label="Output tokens" />
            </section>

            <section class="chart-panel">
              <h2>Input by Model</h2>
              <EChart v-if="data.byModel.length" :option="inputTokensByModelOption" height="300px" label="Input tokens by model" />
              <div v-else class="no-data">No LLM calls</div>
            </section>

            <section class="chart-panel">
              <h2>Output by Model</h2>
              <EChart v-if="data.byModel.length" :option="outputTokensByModelOption" height="300px" label="Output tokens by model" />
              <div v-else class="no-data">No LLM calls</div>
            </section>
          </div>

          <!-- Latency & Cost Row -->
          <div class="latency-row">
            <section class="chart-panel">
              <h2>Latency by Model</h2>
              <EChart v-if="data.byModel.length" :option="latencyByModelOption" height="300px" label="Latency p95 by model" />
              <div v-else class="no-data">No LLM calls</div>
            </section>

            <section class="chart-panel">
              <h2>Cost by Model</h2>
              <EChart v-if="data.byModel.length" :option="costByModelOption" height="300px" label="Cost by model" />
              <div v-else class="no-data">No LLM calls</div>
            </section>
          </div>

          <!-- Details Row -->
          <div class="details-grid">
            <section class="detail-panel">
              <div class="panel-header">
                <h3>AI Models</h3>
                <span class="panel-count">{{ data.byModel.length }}</span>
              </div>
              <div v-if="!data.byModel.length" class="empty-state">No LLM calls</div>
              <div v-else class="model-grid">
                <div v-for="m in data.byModel" :key="m.model" class="model-card">
                  <div class="model-title">{{ m.model }}</div>
                  <div class="model-stat-main">
                    <div class="model-number">{{ formatCount(m.calls) }}</div>
                    <div class="model-label">calls</div>
                  </div>
                  <div class="model-stats-row">
                    <div class="model-stat-item">
                      <div class="stat-value">{{ formatCount(m.inputTokens + m.outputTokens) }}</div>
                      <div class="stat-label">tokens</div>
                    </div>
                    <div class="model-stat-item">
                      <div class="stat-value" style="color: var(--mt-accent)">{{ formatDuration(m.p95Ms) }}</div>
                      <div class="stat-label">latency p95</div>
                    </div>
                    <div class="model-stat-item">
                      <div class="stat-value" style="color: var(--mt-accent)">{{ formatCostUsd(m.costUsd) || "n/a" }}</div>
                      <div class="stat-label">cost</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="detail-panel">
              <div class="panel-header">
                <h3>Response Topics</h3>
                <span class="panel-count">{{ data.byTopic.length }}</span>
              </div>
              <div v-if="!data.byTopic.length" class="empty-state">No topics extracted yet for this range</div>
              <EChart v-else :option="topicUsageOption" height="320px" label="Response topics" />
            </section>
          </div>
        </template>
      </q-tab-panel>

      <q-tab-panel name="compare" class="metrics-tab-panel">
        <section class="detail-panel compare-panel">
          <div class="panel-header">
            <h3>Compare agents</h3>
          </div>

          <div class="compare-selectors">
            <div class="compare-slot">
              <label>Agent A</label>
              <div class="compare-slot-fixed">{{ agentAName }}</div>
              <span class="compare-slot-hint">Set via the agent selector above</span>
            </div>
            <div class="compare-vs">vs</div>
            <div class="compare-slot">
              <label>Agent B</label>
              <Select :model-value="compareAgentId" :options="compareOptions" placeholder="Choose an agent to compare" @update:model-value="(id) => (compareAgentId = id)" />
            </div>
          </div>

          <EmptyState v-if="!compareAgentId" icon="compare_arrows" title="Pick an agent to compare">Choose Agent B above to compare it against {{ agentAName }}.</EmptyState>
          <ErrorBanner v-else-if="compareB.error.value" :error="compareB.error.value" @retry="loadCompare" />
          <div v-else-if="compareB.loading.value && !compareData" class="loading-box">
            <q-spinner size="32px" color="primary" />
          </div>
          <template v-else-if="compareData">
            <table class="compare-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{{ agentAName }}</th>
                  <th>{{ agentBName }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in compareRows" :key="row.label">
                  <td class="compare-row-label">{{ row.label }}</td>
                  <td>{{ row.a }}</td>
                  <td>{{ row.b }}</td>
                </tr>
              </tbody>
            </table>

            <div class="compare-charts">
              <div class="compare-chart-box">
                <div class="compare-chart-title">Executions</div>
                <EChart :option="compareActivityOption" height="220px" label="Executions comparison" />
              </div>
              <div class="compare-chart-box">
                <div class="compare-chart-title">Total tokens</div>
                <EChart :option="compareTokensOption" height="220px" label="Tokens comparison" />
              </div>
              <div class="compare-chart-box">
                <div class="compare-chart-title">Latency p95</div>
                <EChart :option="compareLatencyOption" height="220px" label="Latency comparison" />
              </div>
            </div>
          </template>
        </section>
      </q-tab-panel>

      <q-tab-panel name="custom" class="metrics-tab-panel">
        <CustomChartsPanel :experiment-id="experimentId" :range="customChartsRange" />
      </q-tab-panel>

      <q-tab-panel v-for="r in reports.data.value ?? []" :key="r.id" :name="reportTabName(r.id)" class="metrics-tab-panel">
        <MetricReportView
          v-if="reportIdFromTab(activeTab) === r.id"
          :experiment-id="experimentId"
          :report-id="r.id"
          :range="customChartsRange"
          @renamed="(name) => onReportRenamed(r.id, name)"
          @deleted="onReportDeleted"
        />
      </q-tab-panel>
    </q-tab-panels>
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

.loading-box {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 240px;
}

.metrics-tabs-row {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--mt-line);
}

.metrics-tabs {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 44px;
  border-bottom: none;
}

.add-report-btn {
  flex-shrink: 0;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mt-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 10px 4px;
  white-space: nowrap;
}

.add-report-btn:hover {
  color: var(--mt-accent);
}

.create-report-card {
  padding: 8px;
  min-width: 360px;
}

.create-report-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--mt-ink);
  margin-bottom: 8px;
}

.text-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm, 8px);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
}

.text-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
}

.metrics-tabs :deep(.q-tab) {
  min-height: 44px;
  padding: 0 4px;
  margin-right: 28px;
}

.metrics-tabs :deep(.q-tab:last-child) {
  margin-right: 0;
}

.metrics-tabs :deep(.q-tab__content) {
  min-width: 0;
}

.metrics-tabs :deep(.q-tab__label) {
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--mt-muted);
}

.metrics-tabs :deep(.q-tab--active .q-tab__label) {
  color: var(--mt-ink);
}

.metrics-tabs :deep(.q-tab--disable) {
  opacity: 0.45;
}

.metrics-tabs :deep(.q-tabs__content) {
  gap: 0;
}

.metrics-tabs :deep(.q-tab__indicator) {
  height: 2px;
}

.metrics-tab-panels {
  background: transparent;
}

.metrics-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 0 0;
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
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  text-align: center;
}

.summary-number {
  font-size: 32px;
  font-weight: 800;
  color: var(--mt-accent);
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
  grid-template-columns: 1.8fr 1fr 1fr 1fr 1fr;
  gap: 16px;
}

.status-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 28px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
  border-left: 5px solid;
}

.status-card.ok {
  border-left-color: var(--mt-accent);
}
.status-card.warn {
  border-left-color: var(--mt-warn-ink);
}
.status-card.error {
  border-left-color: var(--mt-err-ink);
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
  background: color-mix(in srgb, var(--mt-accent) 12%, transparent);
}
.status-card.warn .status-icon {
  background: color-mix(in srgb, var(--mt-warn-ink) 12%, transparent);
}
.status-card.error .status-icon {
  background: color-mix(in srgb, var(--mt-err-ink) 12%, transparent);
}

.status-icon i {
  width: 36px;
  height: 36px;
  border-radius: 50%;
}

.status-card.ok .status-icon i {
  background: var(--mt-accent);
}
.status-card.warn .status-icon i {
  background: var(--mt-warn-ink);
}
.status-card.error .status-icon i {
  background: var(--mt-err-ink);
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
  color: var(--mt-accent);
  line-height: 1;
  letter-spacing: -0.05em;
  margin-top: 4px;
}

.status-card.warn .status-value {
  color: var(--mt-warn-ink);
}
.status-card.error .status-value {
  color: var(--mt-err-ink);
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
  border-radius: var(--mt-radius-lg);
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

.metric-value-with-icon {
  display: flex;
  align-items: center;
  gap: 8px;
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
  color: var(--mt-err-ink);
  cursor: pointer;
  transition: color 0.2s;
  text-decoration: none;
}

.error-link:hover {
  color: var(--mt-err-ink);
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
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-panel {
  padding: 28px;
  border-radius: var(--mt-radius-lg);
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
  border-radius: var(--mt-radius-lg);
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
  color: var(--mt-accent);
}

.agent-select {
  width: 200px;
}

.compare-panel {
  margin-bottom: 16px;
}

.compare-panel .panel-header {
  flex-wrap: wrap;
}

.compare-selectors {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 16px 20px;
  margin-bottom: 20px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
}

.compare-slot {
  flex: 1 1 260px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.compare-slot label {
  font-size: 11px;
  font-weight: 700;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.compare-slot-fixed {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm, 8px);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font-size: 13px;
  font-weight: 600;
  color: var(--mt-ink);
}

.compare-slot-hint {
  font-size: 11px;
  color: var(--mt-muted);
}

.compare-vs {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 18px;
}

.compare-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 20px;
  font-size: 13px;
}

.compare-table th,
.compare-table td {
  padding: 8px 12px;
  text-align: right;
  border-bottom: 1px solid var(--mt-soft);
}

.compare-table th:first-child,
.compare-table td:first-child {
  text-align: left;
}

.compare-table th {
  color: var(--mt-muted);
  font-weight: 700;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.compare-row-label {
  color: var(--mt-muted);
  font-weight: 500;
}

.compare-table td:not(.compare-row-label) {
  font-weight: 700;
  color: var(--mt-ink);
}

.compare-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.compare-chart-box {
  background: var(--mt-soft);
  border-radius: var(--mt-radius-sm);
  padding: 12px;
}

.compare-chart-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  margin-bottom: 8px;
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
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  border: 2px solid var(--mt-line);
  transition: all 0.2s ease;
}

.model-card:hover {
  border-color: var(--mt-accent);
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
  color: var(--mt-accent);
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
  grid-template-columns: 1fr 1fr 1fr;
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
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  border: 2px solid var(--mt-line);
  transition: all 0.2s ease;
}

.tool-card:hover {
  border-color: var(--mt-accent);
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
  border-radius: var(--mt-radius-sm);
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
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  text-align: center;
}

.summary-value {
  font-size: 32px;
  font-weight: 800;
  color: var(--mt-accent);
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
    grid-template-columns: repeat(3, 1fr);
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
  .tokens-grid,
  .latency-row {
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
