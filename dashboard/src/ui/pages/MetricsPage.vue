<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import type { EChartsCoreOption } from "echarts/core";
import { computed, ref, watch } from "vue";
import { chartColors } from "../chart-theme";
import { formatCostUsd, formatCount, formatDuration, formatPercent, formatRelativeTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import { formatSatisfaction } from "@/domain/feedback";
import { useQuasar } from "quasar";
import ApprovalInbox from "../components/ApprovalInbox.vue";
import AgentCompareView from "../components/AgentCompareView.vue";
import CustomChartsPanel from "../components/CustomChartsPanel.vue";
import MetricReportView from "../components/MetricReportView.vue";
import ReportCard from "../components/ReportCard.vue";
import ErrorOverviewCard from "../components/ErrorOverviewCard.vue";
import EChart from "../components/EChart.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useLiveRefresh } from "../composables/useLiveRefresh";
import { useFilters } from "../composables/useFilters";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import { useRoute, useRouter } from "vue-router";
import Button from "../components/Button.vue";

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
const goToErrors = () => {
  router.push({ name: "conversations", params: { experimentId: experimentId.value }, query: { ...f.shared.value, status: "error" } });
};

const overview = useAsync((signal) => api.getOverview({ ...f.resolve(), service: f.service.value }, signal));
// valoraciones humanas bajas del mismo rango, para "Needs attention" (ADR-049); si falla, simplemente no se muestran
const lowRated = useAsync((signal) => api.getLowRated(f.resolve(), signal));
// 👍/👎 de usuario final del mismo rango (ADR-062); sin votos o si falla, no aparece ni el KPI ni los avisos
const feedback = useAsync((signal) => api.getFeedbackOverview(f.resolve(), signal));
// causas de los errores en lenguaje de negocio (ADR-066); si falla o no hay errores, la tarjeta no aparece
const errorOverview = useAsync((signal) => api.getErrorOverview(f.resolve(), signal));
async function loadOverview() {
  void errorOverview.run();
  void lowRated.run();
  void feedback.run();
  if (await overview.run()) liveRefresh.touch();
}
const liveRefresh = useLiveRefresh(loadOverview, { isBusy: () => overview.loading.value });
const reload = () => {
  void loadOverview();
};
watch([f.rangeSig, f.service], reload, { immediate: true });

const data = computed(() => overview.data.value);
const customChartsRange = computed(() => f.resolve());
const empty = computed(() => data.value !== null && data.value.totals.traces === 0 && data.value.totals.spans === 0);


const successRate = computed(() => (data.value ? 1 - data.value.totals.errorRate : 1));
const health = computed(() => {
  const rate = data.value?.totals.errorRate ?? 0;
  const executions = formatCount(data.value?.totals.traces ?? 0);
  const ok = `${formatPercent(successRate.value)} of the ${executions} executions in this range finished without errors.`;
  if (rate === 0) return { key: "ok", title: "Your assistant is healthy", text: ok };
  if (rate < 0.05) return { key: "warn", title: "Some executions are failing", text: ok };
  return { key: "error", title: "Your assistant needs attention", text: ok };
});

// ---- "Needs attention" (ADR-048): lo accionable de esta pantalla, en lenguaje llano y con acción directa ----
const reviewQueues = useAsync((signal) => api.listAnnotationQueues(false, signal));
void reviewQueues.run();
const pendingReviews = computed(() => (reviewQueues.data.value?.items ?? []).reduce((n, q) => n + q.progress.pending, 0));
const goToReview = () => router.push({ name: "annotation-queues", params: { experimentId: experimentId.value } });
const attention = computed(() => {
  const d = data.value;
  if (!d) return [];
  const items: { key: string; tone: "error" | "warn" | "info"; title: string; text: string; cta: string; go: () => void }[] = [];
  if (d.totals.errorTraces > 0) {
    items.push({ key: "errors", tone: "error", title: `${formatCount(d.totals.errorTraces)} ${d.totals.errorTraces === 1 ? "execution" : "executions"} ended with errors`, text: `${formatPercent(d.totals.errorRate)} of executions in this range.`, cta: "View", go: goToErrors });
  }
  const failing = d.byTool.filter((t) => t.errors > 0 && toolErrorRate(t) >= 0.02).sort((a, b) => toolErrorRate(b) - toolErrorRate(a)).slice(0, 2);
  for (const t of failing) {
    items.push({ key: `tool:${t.tool}`, tone: "warn", title: `${t.tool} fails ${formatPercent(toolErrorRate(t))} of calls`, text: `${formatCount(t.errors)} of ${formatCount(t.calls)} calls failed.`, cta: "Inspect", go: goToErrors });
  }
  const rated = lowRated.data.value;
  if (rated && rated.count > 0) {
    const latest = rated.items[0]!;
    items.push({
      key: "low-rated",
      tone: "warn",
      title: `${formatCount(rated.count)} ${rated.count === 1 ? "trace was" : "traces were"} rated low by reviewers`,
      text: `Latest: ${latest.configName} = ${latest.value}.`,
      cta: "Open latest",
      go: () => void router.push({ name: "trace", params: { experimentId: experimentId.value, traceId: latest.traceId } }),
    });
  }
  const votes = feedback.data.value;
  if (votes && votes.summary.down > 0 && votes.recentDown.length > 0) {
    const latest = votes.recentDown[0]!;
    items.push({
      key: "thumbs-down",
      tone: "warn",
      title: `${formatCount(votes.summary.down)} ${votes.summary.down === 1 ? "answer got" : "answers got"} a thumbs down from users`,
      text: latest.comment ? `Latest: “${latest.comment}”` : "Open the latest one to see what happened.",
      cta: "Open latest",
      go: () => void router.push({ name: "trace", params: { experimentId: experimentId.value, traceId: latest.traceId } }),
    });
  }
  if (votes && votes.alignment.misaligned > 0) {
    items.push({
      key: "feedback-misaligned",
      tone: "info",
      title: `Users and reviewers disagree on ${formatCount(votes.alignment.misaligned)} ${votes.alignment.misaligned === 1 ? "answer" : "answers"}`,
      text: "Good to check whether the review rubric misses what users care about.",
      cta: "Review",
      go: goToReview,
    });
  }
  if (pendingReviews.value > 0) {
    items.push({ key: "review", tone: "info", title: `${formatCount(pendingReviews.value)} ${pendingReviews.value === 1 ? "item is" : "items are"} waiting for review`, text: "Conversations queued for human review.", cta: "Start", go: goToReview });
  }
  return items;
});
/** KPI de satisfacción de usuario final: solo si hay votos en el rango. Verde ≥ 80 %, ámbar ≥ 60 %, rojo por debajo. */
const satisfactionKpi = computed(() => {
  const s = feedback.data.value?.summary;
  if (!s || s.total === 0) return [];
  const tone = s.satisfaction === null ? "" : s.satisfaction >= 80 ? "good" : s.satisfaction >= 60 ? "warn" : "error";
  return [{ key: "satisfaction", label: "USER SATISFACTION", value: formatSatisfaction(s.satisfaction), sub: `${formatCount(s.up)} positive · ${formatCount(s.down)} negative from ${formatCount(s.ratedTraces)} ${s.ratedTraces === 1 ? "answer" : "answers"}`, tone, link: false }];
});
const kpis = computed(() => {
  const d = data.value;
  if (!d) return [];
  return [
    { key: "conversations", label: "CONVERSATIONS", value: formatCount(d.totals.conversations), sub: `${formatCount(d.totals.traces)} executions`, tone: "", spark: true, link: false },
    { key: "success", label: "SUCCESS RATE", value: formatPercent(successRate.value), sub: health.value.title, tone: health.value.key === "ok" ? "good" : health.value.key, link: false },
    { key: "latency", label: "RESPONSE TIME P95", value: formatDuration(d.latencyMs.p95), sub: `median ${formatDuration(d.latencyMs.p50)}`, tone: "" },
    { key: "errors", label: "ERRORS", value: formatCount(d.totals.errorTraces), sub: `${formatPercent(d.totals.errorRate)} of executions`, tone: d.totals.errorTraces > 0 ? "error" : "", link: d.totals.errorTraces > 0 },
    { key: "cost", label: "COST", value: formatCostUsd(d.totals.costUsd) ?? "–", sub: `${formatCount(d.totals.totalTokens)} tokens`, tone: "" },
    ...satisfactionKpi.value,
  ];
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
  new Date(iso).toLocaleString("en-US", longRange.value ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "2-digit", minute: "2-digit", hour12: false });

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
      { name: "Conversations", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.traces - p.errorTraces) ?? [], itemStyle: { color: c.primary, borderRadius: [0, 0, 0, 0] } },
      { name: "Errors", type: "bar", stack: "t", barMaxWidth: 26, data: d?.timeseries.map((p) => p.errorTraces) ?? [], itemStyle: { color: c.danger, borderRadius: [6, 6, 0, 0] } },
      {
        name: "p95 latency",
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

const toolErrorRate = (t: { calls: number; errors: number }) => (t.calls ? t.errors / t.calls : 0);

// ---- tarjetas inferiores del Overview: Models, Human review quality, Latest evaluation runs ----
const topModels = computed(() => [...(data.value?.byModel ?? [])].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.calls - a.calls).slice(0, 4));

const latestRuns = useAsync((signal) => api.listRuns(signal));
void latestRuns.run();
const recentRuns = computed(() =>
  (latestRuns.data.value?.items ?? []).slice(0, 4).map((r) => {
    const a = r.aggregates[0];
    const tone = a ? aggregateTone(a) : "default";
    return { id: r.id, datasetId: r.datasetId, name: r.name, when: `${formatRelativeTime(r.createdAt, Date.now())} · ${r.itemCount} items`, score: a ? aggregateValueLabel(a) : "–", tone };
  }),
);

// valoración humana media por criterio, a partir de los resultados de las colas de revisión (solo perfil técnico:
// si la petición se rechaza, la tarjeta se queda vacía en vez de romper la pantalla)
const reviewQuality = useAsync(async (signal) => {
  const queues = (await api.listAnnotationQueues(false, signal)).items.slice(0, 3);
  const acc = new Map<string, { name: string; sum: number; n: number; max: number }>();
  for (const q of queues) {
    const results = await api.getQueueResults(q.id, { status: "completed", limit: 200 }, signal);
    const configs = new Map(results.configs.map((c) => [c.id, c]));
    for (const item of results.items) {
      for (const crit of item.criteria) {
        const cfg = configs.get(crit.configId);
        if (!cfg || cfg.dataType === "categorical") continue;
        const raw = crit.resolution?.value ?? (crit.labels.length ? crit.labels.reduce((s, l) => s + (cfg.dataType === "boolean" ? (l.value === "true" ? 1 : 0) : Number(l.value)), 0) / crit.labels.length : null);
        const v = raw === null ? null : cfg.dataType === "boolean" ? (raw === "true" || raw === 1 ? 1 : Number(raw) || 0) : Number(raw);
        if (v === null || Number.isNaN(v)) continue;
        const e = acc.get(cfg.id) ?? { name: cfg.name, sum: 0, n: 0, max: cfg.dataType === "boolean" ? 1 : (cfg.maxValue ?? 5) };
        e.sum += v;
        e.n += 1;
        acc.set(cfg.id, e);
      }
    }
  }
  return [...acc.values()].map((e) => {
    const avg = e.sum / e.n;
    const ratio = Math.min(1, avg / e.max);
    return { name: e.name, value: e.max === 1 ? formatPercent(avg) : `${avg.toFixed(1)} / ${e.max}`, width: Math.round(ratio * 100), low: ratio < 0.75 };
  });
});
void reviewQuality.run();

// sparklines de las tarjetas KPI (58×24), normalizadas al rango de cada serie
function sparkPoints(values: number[]): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return values.map((v, i) => `${((i / (values.length - 1)) * 58).toFixed(1)},${(21 - ((v - min) / span) * 18).toFixed(1)}`).join(" ");
}
const tonePalette = (tone: string) => (tone === "error" ? "var(--mt-err)" : "var(--mt-accent)");
const kpiCards = computed(() => {
  const series = data.value?.timeseries ?? [];
  const sparks: Record<string, number[]> = {
    conversations: series.map((p) => p.traces),
    success: series.map((p) => (p.traces ? 1 - p.errorTraces / p.traces : 1)),
    latency: series.map((p) => p.p95Ms),
    errors: series.map((p) => p.errorTraces),
    cost: series.map((p) => p.totalTokens),
    satisfaction: (feedback.data.value?.days ?? []).map((d) => (d.up + d.down ? d.up / (d.up + d.down) : 1)),
  };
  return kpis.value.map((k) => ({ ...k, points: sparkPoints(sparks[k.key] ?? []), stroke: tonePalette(k.key === "errors" && k.tone === "error" ? "error" : "") }));
});

const attentionIcon = { error: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", warn: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", info: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" } as const;
const goToFirstAttention = () => attention.value[0]?.go();

// ---- Vistas de la página (ADR-059): cada una tiene su ruta y su entrada de submenú; el router decide cuál se pinta ----
type View = "summary" | "compare" | "charts" | "reports" | "report";
const view = computed(() => (route.meta.view as View | undefined) ?? "summary");
const PANEL: Record<View, string> = { summary: "overview", compare: "compare", charts: "custom", reports: "reports", report: "report" };
const activePanel = computed(() => PANEL[view.value]);
const reportId = computed(() => (view.value === "report" ? String(route.params.reportId) : null));
const VIEW_TITLES: Record<View, string> = { summary: "Overview", compare: "Compare", charts: "Custom charts", reports: "Reports", report: "Report" };
const crumbs = computed(() => {
  const root = { label: "Overview", to: { name: "overview", params: { experimentId: experimentId.value } } };
  if (view.value === "summary") return [{ label: "Overview" }];
  if (view.value === "report") return [root, { label: "Reports", to: { name: "overview-reports", params: { experimentId: experimentId.value } } }, { label: pageTitle.value }];
  return [root, { label: VIEW_TITLES[view.value] }];
});

// ---- Informes guardados (ADR-035): una página de listado y una por informe ----
const reports = useAsync((signal) => identityApi.listMetricReports(experimentId.value, signal));
watch(experimentId, () => void reports.run(), { immediate: true });
const pageTitle = computed(() => (view.value === "report" ? (reports.data.value?.find((r) => r.id === reportId.value)?.name ?? "Report") : VIEW_TITLES[view.value]));

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
    creatingReport.value = false;
    void router.push({ name: "overview-report", params: { experimentId: experimentId.value, reportId: created.id } });
  } finally {
    creatingReportBusy.value = false;
  }
}

function onReportRenamed(reportId: string, name: string) {
  const item = reports.data.value?.find((r) => r.id === reportId);
  if (item) item.name = name;
}

function onReportDeleted() {
  void reports.run();
  void router.push({ name: "overview-reports", params: { experimentId: experimentId.value } });
}

// ---- Comparativa entre 2 agentes (superpuesta sobre el mismo rango) ----
const compareAgentId = ref<string | null>(null);
const compareOptions = computed(() => agentOptions.value.filter((o) => o.value !== experimentId.value));
const agentAName = computed(() => experiments.data.value?.find((e) => e.id === experimentId.value)?.name ?? "This agent");
const agentBName = computed(() => experiments.data.value?.find((e) => e.id === compareAgentId.value)?.name ?? "Agent B");

const compareB = useAsync((signal) => api.getOverviewForExperiment(compareAgentId.value as string, f.resolve(), signal));
function loadCompare() {
  if (activePanel.value === "compare" && compareAgentId.value) void compareB.run();
}
watch([f.rangeSig, compareAgentId, activePanel], loadCompare);
const compareData = computed(() => compareB.data.value);

watch([activePanel, compareOptions], ([panel]) => {
  if (panel === "compare" && !compareAgentId.value) compareAgentId.value = compareOptions.value[0]?.value ?? null;
});

function swapAgents() {
  const previousA = experimentId.value;
  if (!compareAgentId.value) return;
  const nextA = compareAgentId.value;
  compareAgentId.value = previousA;
  void router.push({ name: "overview-compare", params: { experimentId: nextA }, query: route.query });
}
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="crumbs" icon="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" :title="pageTitle" />

    <q-dialog v-model="creatingReport">
      <q-card class="create-report-card">
        <q-card-section>
          <div class="create-report-title">New report</div>
          <TextInput v-model="newReportName" placeholder="Report name" @keyup.enter="createReport" />
        </q-card-section>
        <q-card-actions align="right">
          <Button @click="creatingReport = false">Cancel</Button>
          <Button variant="primary" :disabled="!newReportName.trim()" :loading="creatingReportBusy" @click="createReport">Create</Button>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-tab-panels :model-value="activePanel" keep-alive class="metrics-tab-panels">
      <q-tab-panel name="overview" class="metrics-tab-panel">
        <ApprovalInbox class="overview-approvals" />
        <ErrorBanner v-if="overview.error.value" :error="overview.error.value" @retry="reload" />
        <div v-else-if="overview.loading.value && !data" class="loading-box">
          <q-spinner size="32px" color="primary" />
        </div>

        <EmptyState v-else-if="empty" icon="insights" title="No data in this range">Run an instrumented agent or extend the time range.</EmptyState>

        <template v-else-if="data">
          <section class="health" :class="health.key" data-testid="health-banner">
            <span class="health-icon" aria-hidden="true">
              <svg v-if="health.key === 'ok'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5M12 16.5h.01" /></svg>
            </span>
            <div class="health-body">
              <h2>{{ health.title }}</h2>
              <p>{{ health.text }}<template v-if="attention.length"> {{ attention.length }} {{ attention.length === 1 ? "thing" : "things" }} could use a look.</template></p>
            </div>
            <button v-if="attention.length" type="button" class="health-cta" @click="goToFirstAttention">See what needs attention</button>
          </section>

          <section class="kpi-grid" aria-label="Key figures">
            <div v-for="k in kpiCards" :key="k.key" class="kpi" :data-testid="`kpi-${k.key}`">
              <span class="kpi-label">{{ k.label }}</span>
              <div class="kpi-main">
                <span class="kpi-value" :class="k.tone">{{ k.value }}</span>
                <svg v-if="k.points" class="kpi-spark" width="58" height="24" viewBox="0 0 58 24" aria-hidden="true"><polyline :points="k.points" fill="none" :stroke="k.stroke" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" /></svg>
              </div>
              <a v-if="k.link" class="kpi-sub link" @click="goToErrors">{{ k.sub }} · view →</a>
              <span v-else class="kpi-sub" :class="k.tone">{{ k.sub }}</span>
            </div>
          </section>

          <div class="overview-row split">
            <section class="card" aria-label="Activity">
              <div class="card-head">
                <h2>Activity</h2>
                <span class="legend"><i class="sw" style="background: var(--mt-accent)" />Conversations</span>
                <span class="legend"><i class="sw" style="background: var(--mt-err)" />Errors</span>
                <span class="legend"><i class="sw line" style="background: var(--mt-highlight)" />p95 latency</span>
              </div>
              <EChart :option="activityOption" height="200px" label="Conversations, errors, and p95 latency" />
            </section>

            <section class="card attention" aria-label="Needs attention">
              <div class="card-head">
                <h2>Needs attention</h2>
                <span v-if="attention.length" class="attention-count">{{ attention.length }}</span>
              </div>
              <p v-if="!attention.length" class="all-clear" data-testid="all-clear">Nothing needs your attention in this range.</p>
              <button v-for="a in attention" :key="a.key" type="button" class="attn" :class="a.tone" data-testid="attention-item" @click="a.go">
                <span class="attn-icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path :d="attentionIcon[a.tone]" /></svg>
                </span>
                <span class="attn-text"><strong>{{ a.title }}</strong><span>{{ a.text }}</span></span>
                <span class="attn-cta">{{ a.cta }} →</span>
              </button>
            </section>
          </div>

          <ErrorOverviewCard v-if="errorOverview.data.value && errorOverview.data.value.categories.length" :overview="errorOverview.data.value" @view="goToErrors" />

          <div class="overview-row thirds">
            <section class="card list-card" aria-label="Models">
              <div class="card-head"><h2>Models</h2><span class="spacer" /><span class="card-link">{{ data.byModel.length }} in range</span></div>
              <p v-if="!topModels.length" class="list-empty">No LLM calls in this range.</p>
              <div v-for="m in topModels" :key="m.model" class="model-row">
                <span class="mono ellipsis">{{ m.model }}</span>
                <span class="mono muted right">{{ formatDuration(m.p95Ms) }}</span>
                <span class="mono right">{{ formatCostUsd(m.costUsd) ?? "–" }}</span>
              </div>
            </section>

            <section class="card list-card" aria-label="Human review quality">
              <div class="card-head">
                <h2>Human review quality</h2><span class="spacer" />
                <a class="card-link" @click="goToReview">Review →</a>
              </div>
              <p v-if="!reviewQuality.data.value?.length" class="list-empty">No completed human reviews yet.</p>
              <div v-for="q in reviewQuality.data.value ?? []" :key="q.name" class="quality-row">
                <div class="quality-line"><span class="quality-name">{{ q.name }}</span><span class="mono">{{ q.value }}</span></div>
                <div class="bar"><div class="bar-fill" :class="{ low: q.low }" :style="{ width: `${q.width}%` }" /></div>
              </div>
            </section>

            <section class="card list-card" aria-label="Latest evaluation runs">
              <div class="card-head">
                <h2>Latest evaluation runs</h2><span class="spacer" />
                <a class="card-link" @click="router.push({ name: 'runs', params: { experimentId } })">All runs →</a>
              </div>
              <p v-if="!recentRuns.length" class="list-empty">No evaluation runs yet.</p>
              <a v-for="r in recentRuns" :key="r.id" class="run-row" @click="router.push({ name: 'dataset-run', params: { experimentId, datasetId: r.datasetId, runId: r.id } })">
                <span class="run-text"><strong>{{ r.name }}</strong><span>{{ r.when }}</span></span>
                <span class="run-score" :class="r.tone">{{ r.score }}</span>
              </a>
            </section>
          </div>
        </template>
      </q-tab-panel>

      <q-tab-panel name="compare" class="metrics-tab-panel">
        <AgentCompareView
          :name-a="agentAName"
          :name-b="agentBName"
          :a="data"
          :b="compareData"
          :options="compareOptions"
          :agent-b-id="compareAgentId"
          :loading="compareB.loading.value"
          :error="compareB.error.value"
          :long-range="longRange"
          @update:agent-b-id="(id) => (compareAgentId = id)"
          @swap="swapAgents"
          @retry="loadCompare"
        />
      </q-tab-panel>

      <q-tab-panel name="custom" class="metrics-tab-panel">
        <CustomChartsPanel :experiment-id="experimentId" :range="customChartsRange" />
      </q-tab-panel>

      <q-tab-panel name="reports" class="metrics-tab-panel">
        <div class="reports-head">
          <p class="reports-hint">A report is a saved set of custom charts you can share with the rest of the experiment.</p>
          <button type="button" class="add-report-btn mt-new" data-testid="new-report" @click="openCreateReport">+ New report</button>
        </div>
        <ErrorBanner v-if="reports.error.value" :error="reports.error.value" @retry="reports.run()" />
        <EmptyState v-else-if="reports.data.value && reports.data.value.length === 0" icon="dashboard" title="No reports yet">Create one to group the charts you check every week.</EmptyState>
        <div v-else class="report-list">
          <ReportCard v-for="r in reports.data.value ?? []" :key="r.id" :experiment-id="experimentId" :report="r" />
        </div>
      </q-tab-panel>

      <q-tab-panel name="report" class="metrics-tab-panel">
        <MetricReportView
          v-if="reportId"
          :key="reportId"
          :experiment-id="experimentId"
          :report-id="reportId"
          :range="customChartsRange"
          @renamed="(name) => onReportRenamed(reportId!, name)"
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

.reports-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.reports-hint {
  margin: 0;
  color: var(--mt-muted);
}

.report-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
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



.metrics-tab-panels {
  background: transparent;
}

.overview-approvals { margin-bottom: 12px; }
.metrics-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 0 0;
}

/* Overview (diseño "1 · Overview"): banner de salud, 5 KPIs, actividad + atención, y 3 tarjetas de detalle */
.health {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid transparent;
}
.health.ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); border-color: color-mix(in srgb, var(--mt-ok) 25%, transparent); }
.health.warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); border-color: color-mix(in srgb, var(--mt-warn) 30%, transparent); }
.health.error { background: var(--mt-err-bg); color: var(--mt-err-ink); border-color: color-mix(in srgb, var(--mt-err) 25%, transparent); }
.health-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  color: #fff;
}
.health.ok .health-icon { background: var(--mt-ok); }
.health.warn .health-icon { background: var(--mt-warn); }
.health.error .health-icon { background: var(--mt-err); }
.health-body { flex: 1; min-width: 0; }
.health-body h2 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
.health-body p { margin: 2px 0 0; font-weight: 500; }
.health-cta {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  background: var(--mt-card);
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.health-cta:hover { background: var(--mt-soft-2); }

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 13px 15px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
}
.kpi-label { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--mt-muted); }
.kpi-main { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
.kpi-value { font-size: 25px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.kpi-value.error, .kpi-sub.error { color: var(--mt-err-ink); }
.kpi-value.warn, .kpi-sub.warn { color: var(--mt-warn-ink); }
.kpi-sub.good { color: var(--mt-ok-ink); }
.kpi-spark { flex-shrink: 0; }
.kpi-sub { font-size: 11.5px; font-weight: 600; color: var(--mt-muted); }
.kpi-sub.link { color: var(--mt-err-ink); cursor: pointer; }
.kpi-sub.link:hover { text-decoration: underline; }

.overview-row { display: grid; gap: 12px; }
.overview-row.split { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
.overview-row.thirds { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  overflow: hidden;
  padding: 14px 16px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
}
.card.list-card, .card.attention { gap: 0; padding: 0; }
.card-head { display: flex; align-items: center; gap: 12px; }
.card.list-card .card-head, .card.attention .card-head { padding: 12px 16px; }
.card-head h2 { margin: 0; font-size: 14px; font-weight: 800; }
.spacer { flex: 1; }
.card-link { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); cursor: pointer; text-decoration: none; }
.legend { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--mt-muted); }
.legend:first-of-type { margin-left: auto; }
.sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; }
.sw.line { width: 12px; height: 2px; border-radius: 0; }
.list-empty { margin: 0; padding: 8px 16px 16px; color: var(--mt-muted); }

.attention-count { padding: 1px 7px; border-radius: var(--mt-radius-xs); background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); font-size: 11px; font-weight: 800; }
.all-clear { margin: 0; padding: 4px 16px 16px; color: var(--mt-muted); }
.attn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px;
  border: 0;
  border-top: 1px solid var(--mt-line-2);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.attn:hover { background: var(--mt-soft-2); }
.attn-icon { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: var(--mt-radius-sm); background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.attn.error .attn-icon { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.attn.warn .attn-icon { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.attn-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.attn-text strong { font-weight: 700; }
.attn-text span { font-size: 12px; color: var(--mt-muted); }
.attn-cta { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); white-space: nowrap; }

.mono { font-family: var(--mt-mono, "JetBrains Mono", monospace); font-size: 12px; }
.muted { color: var(--mt-muted); }
.right { text-align: right; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px 56px;
  gap: 10px;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid var(--mt-line-2);
}
.quality-row { display: flex; flex-direction: column; gap: 5px; padding: 8px 16px; border-top: 1px solid var(--mt-line-2); }
.quality-line { display: flex; justify-content: space-between; }
.quality-name { font-weight: 600; }
.bar { height: 6px; border-radius: 3px; background: var(--mt-line-2); }
.bar-fill { height: 6px; border-radius: 3px; background: var(--mt-accent); }
.bar-fill.low { background: var(--mt-highlight); }
.run-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 16px;
  border-top: 1px solid var(--mt-line-2);
  color: inherit;
  cursor: pointer;
}
.run-row:hover { background: var(--mt-soft-2); }
.run-text { display: flex; flex-direction: column; min-width: 0; }
.run-text strong { font-weight: 700; }
.run-text span { font-size: 11.5px; color: var(--mt-muted); }
.run-score { height: 22px; padding: 0 8px; display: flex; align-items: center; border-radius: var(--mt-radius-xs); font: 800 11.5px var(--mt-mono, "JetBrains Mono", monospace); background: var(--mt-soft); color: var(--mt-muted); }
.run-score.positive { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.run-score.negative { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.run-score.warning { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }

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

@media (max-width: 1200px) {
  .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .overview-row.split, .overview-row.thirds { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .health { flex-wrap: wrap; }
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
