<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import type { RunListItemDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { useRoute, useRouter } from "vue-router";
import { formatDateTime, formatPercent } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import { buildOfflineSeries, offlineEvalChartOption, summarizeEvaluators, type EvaluatorSummary } from "../offline-eval-chart-option";
import EChart from "../components/EChart.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterPill from "../components/FilterPill.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import { useExperimentRepo } from "../composables/useExperimentRepo";
import CommitLink from "../components/CommitLink.vue";
import Button from "../components/Button.vue";

const PAGE_SIZE = 20;

const api = useTraceApi();
const router = useRouter();
const route = useRoute();
const repo = useExperimentRepo(() => route.params.experimentId as string);

const $q = useQuasar();

const runs = useAsync((signal) => api.listRuns(signal));
void runs.run();

const search = ref("");
const datasetId = ref<string | undefined>(undefined);
const page = ref(1);
watch([search, datasetId], () => (page.value = 1));

const datasetOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const r of runs.data.value?.items ?? []) seen.set(r.datasetId, r.datasetName);
  return [...seen.entries()].map(([value, label]) => ({ label, value }));
});

const metricNames = computed(() => {
  const names = new Set<string>();
  for (const r of runs.data.value?.items ?? []) for (const a of r.aggregates) names.add(a.name);
  return [...names].sort();
});

const filtered = computed(() => {
  const all = runs.data.value?.items ?? [];
  const q = search.value.trim().toLowerCase();
  return all.filter((r) => (!q || r.name.toLowerCase().includes(q) || r.datasetName.toLowerCase().includes(q)) && (!datasetId.value || r.datasetId === datasetId.value));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const items = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function metricCell(r: RunListItemDto, metric: string): ScoreAggregateDto | null {
  return r.aggregates.find((a) => a.name === metric) ?? null;
}

// ---- tendencia y último vs anterior: solo runs completadas del filtro actual, la más antigua primero ----
const completed = computed(() => filtered.value.filter((r) => r.status === "completed").reverse());
const hasTrend = computed(() => completed.value.length >= 2);
const trendOption = computed(() => offlineEvalChartOption(completed.value, buildOfflineSeries(completed.value, "passRate"), "passRate", $q.dark.isActive));
const deltas = computed(() => summarizeEvaluators(completed.value).filter((s) => s.previous !== null));

function fmt(v: number | null, kind: EvaluatorSummary["kind"]): string {
  if (v === null) return "–";
  return kind === "passRate" ? formatPercent(v) : v.toFixed(2);
}
function deltaLabel(s: EvaluatorSummary): string {
  if (s.delta === null) return "–";
  const sign = s.delta > 0 ? "+" : "";
  return s.kind === "passRate" ? `${sign}${(s.delta * 100).toFixed(1)} pp` : `${sign}${s.delta.toFixed(2)}`;
}
const deltaClass = (s: EvaluatorSummary) => (s.status === "improving" ? "ok" : s.status === "regressing" ? "error" : "unset");

// ---- compare: tick two completed runs and jump to the comparison (ADR-048); the first ticked is the baseline ----
const picked = ref<string[]>([]);
const isPicked = (r: RunListItemDto) => picked.value.includes(r.id);
function togglePick(r: RunListItemDto) {
  if (r.status !== "completed") return;
  picked.value = isPicked(r) ? picked.value.filter((id) => id !== r.id) : [...picked.value, r.id].slice(-2);
}
const pickedRuns = computed(() => picked.value.map((id) => runs.data.value?.items.find((r) => r.id === id)).filter((r): r is RunListItemDto => !!r));
const compare = () => {
  if (picked.value.length !== 2) return;
  void router.push({ name: "trends", params: { experimentId: route.params.experimentId as string }, query: { compare: picked.value.join(",") } });
};

function openRun(run: RunListItemDto) {
  router.push({ name: "dataset-run", params: { datasetId: run.datasetId, runId: run.id } });
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Evaluations' }, { label: 'Runs' }]" icon="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" title="Runs" />

    <div class="toolbar">
      <FilterPill label="Dataset" :model-value="datasetId" :options="datasetOptions" all-label="All" @update:model-value="datasetId = $event" />
      <TextInput type="search" v-model="search" placeholder="Filter runs…" class="search" />
    </div>

    <section v-if="hasTrend" class="insights">
      <div class="mt-card insight">
        <h2>Score trend</h2>
        <EChart :option="trendOption" height="150px" label="Pass rate per evaluator across runs" />
      </div>
      <div class="mt-card insight">
        <h2>Latest vs previous run</h2>
        <div v-for="s in deltas" :key="s.name" class="delta-row">
          <span class="delta-name">{{ s.name }}</span>
          <span class="mono muted">{{ fmt(s.previous, s.kind) }} → <b class="ink">{{ fmt(s.latest, s.kind) }}</b></span>
          <span class="mt-pill mono" :class="deltaClass(s)">{{ deltaLabel(s) }}</span>
        </div>
      </div>
    </section>

    <ErrorBanner v-if="runs.error.value" :error="runs.error.value" @retry="runs.run()" />
    <div v-else-if="runs.loading.value && !runs.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(runs.data.value?.items.length ?? 0) === 0" icon="playlist_add_check" title="No runs yet">
      Run <code>run_experiment(data="…", …)</code> from your script, or open a dataset and run it manually.
    </EmptyState>
    <EmptyState v-else-if="items.length === 0" icon="search_off" title="No matches">Try a different search or dataset.</EmptyState>

    <div v-else class="mt-card table-card">
      <table class="runs">
        <thead>
          <tr>
            <th class="pick" />
            <th>Run</th>
            <th>Dataset</th>
            <th>Code version</th>
            <th>When</th>
            <th v-for="m in metricNames" :key="m" class="center">{{ m }}</th>
            <th class="num">Items</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in items" :key="r.id" class="run-row" :class="{ picked: isPicked(r) }" tabindex="0" @click="openRun(r)" @keydown.enter="openRun(r)">
            <td class="pick" @click.stop>
              <input
                type="checkbox"
                class="pick-box"
                data-testid="pick-run"
                :checked="isPicked(r)"
                :disabled="r.status !== 'completed'"
                :title="r.status !== 'completed' ? 'Only completed runs can be compared' : undefined"
                :aria-label="`Select ${r.name} to compare`"
                @change="togglePick(r)"
              />
            </td>
            <td class="name">{{ r.name }}</td>
            <td class="muted">{{ r.datasetName }} <span class="mono faint">v{{ r.versionMajor }}.{{ r.versionMinor }}</span></td>
            <td @click.stop><CommitLink :revision="r.revision" :repo="repo" :dirty="r.revisionDirty" /></td>
            <td class="muted">{{ formatDateTime(r.createdAt) }}</td>
            <td v-for="m in metricNames" :key="m" class="center">
              <span v-if="metricCell(r, m)" class="mt-pill" :class="{ ok: aggregateTone(metricCell(r, m)!) === 'positive', warn: aggregateTone(metricCell(r, m)!) === 'warning', error: aggregateTone(metricCell(r, m)!) === 'negative', unset: aggregateTone(metricCell(r, m)!) === 'default' }">
                {{ aggregateValueLabel(metricCell(r, m)!) }}
              </span>
              <span v-else class="muted">–</span>
            </td>
            <td class="num mono">{{ r.itemCount }}</td>
            <td>
              <span class="mt-pill" :class="r.status === 'running' ? 'warn' : 'ok'" :title="r.status === 'running' ? 'Still receiving results, or the process stopped before finishing' : undefined">{{ r.status === "running" ? "Running" : "Completed" }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="picked.length > 0" class="compare-bar" data-testid="compare-bar">
      <span class="compare-title">{{ picked.length }} {{ picked.length === 1 ? "run" : "runs" }} selected</span>
      <span class="compare-sub">{{ picked.length === 2 ? `${pickedRuns[0]?.name} (baseline) vs ${pickedRuns[1]?.name}` : "Pick one more run to compare" }}</span>
      <div class="compare-actions">
        <button type="button" class="compare-clear" @click="picked = []">Clear</button>
        <button type="button" class="compare-go" data-testid="compare-go" :disabled="picked.length !== 2" @click="compare">Compare runs →</button>
      </div>
    </div>

    <div v-if="items.length > 0" class="pager">
      <span class="muted">{{ filtered.length }} run{{ filtered.length === 1 ? "" : "s" }}</span>
      <div class="pager-controls">
        <Button size="sm" :disabled="page <= 1" @click="page -= 1">Prev</Button>
        <span class="muted mono">Page {{ page }} / {{ pageCount }}</span>
        <Button size="sm" :disabled="page >= pageCount" @click="page += 1">Next</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search {
  width: 220px;
}
.insights {
  display: grid;
  grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
  gap: 12px;
  flex-shrink: 0;
}
.insight {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
}
.insight h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}
.delta-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 14px;
  align-items: center;
  padding: 7px 0;
  border-top: 1px solid var(--mt-line-2);
}
.delta-name {
  font-weight: 700;
}
.ink {
  color: var(--mt-ink);
  font-weight: 500;
}
.faint {
  color: var(--mt-faint);
  font-size: 11.5px;
}
.center {
  text-align: center;
}
.hint {
  margin: 0;
  font-size: 12.5px;
}
.muted {
  color: var(--mt-muted);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.runs {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 34px;
  padding: 0 14px;
  background: var(--mt-soft);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}
td {
  height: 46px;
  padding: 0 14px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.num {
  text-align: right;
}
.name {
  font-weight: 800;
}
.run-row {
  cursor: pointer;
}
.run-row.picked {
  background: var(--mt-accent-tint);
}
.run-row:hover,
.run-row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  font-size: 12.5px;
}
.pager-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pick {
  width: 18px;
  padding-right: 0;
}
.pick-box {
  accent-color: var(--mt-accent);
  cursor: pointer;
}
.pick-box:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.compare-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 52px;
  padding: 0 18px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-ink);
  color: var(--mt-bg);
  flex-shrink: 0;
}
.compare-title {
  font-weight: 800;
}
.compare-sub {
  opacity: 0.75;
  font-size: 12.5px;
}
.compare-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.compare-clear {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  opacity: 0.8;
  cursor: pointer;
}
.compare-go {
  height: 34px;
  padding: 0 18px;
  border: 0;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-brand);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.compare-go:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
