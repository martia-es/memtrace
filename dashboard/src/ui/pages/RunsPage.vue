<script setup lang="ts">
import type { RunListItemDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import EvaluationsTabs from "../components/EvaluationsTabs.vue";
import FilterPill from "../components/FilterPill.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 20;

const api = useTraceApi();
const router = useRouter();
const route = useRoute();

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
  void router.push({ name: "overview", params: { experimentId: route.params.experimentId as string }, query: { tab: "offline", compare: picked.value.join(",") } });
};

function openRun(run: RunListItemDto) {
  router.push({ name: "dataset-run", params: { datasetId: run.datasetId, runId: run.id } });
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Runs' }]" icon="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" title="Runs">
      <div class="actions">
        <FilterPill label="Dataset" :model-value="datasetId" :options="datasetOptions" all-label="All" @update:model-value="datasetId = $event" />
        <q-input v-model="search" dense outlined placeholder="Filter by run or dataset…" class="search" clearable>
          <template #prepend><q-icon name="search" size="18px" /></template>
        </q-input>
      </div>
    </PageHeader>

    <EvaluationsTabs />

    <p class="hint muted">Every run of every dataset in this experiment, most recent first. Tick two completed runs to compare them.</p>

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
            <th class="num">Version</th>
            <th v-for="m in metricNames" :key="m" class="num">{{ m }}</th>
            <th class="num">Items</th>
            <th>Created</th>
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
            <td class="muted">{{ r.datasetName }}</td>
            <td class="num mono">v{{ r.versionMajor }}.{{ r.versionMinor }} <span v-if="r.status === 'running'" class="mt-pill warn" title="Still receiving results, or the process stopped before finishing">running</span></td>
            <td v-for="m in metricNames" :key="m" class="num">
              <span v-if="metricCell(r, m)" class="mt-pill" :class="{ ok: aggregateTone(metricCell(r, m)!) === 'positive', warn: aggregateTone(metricCell(r, m)!) === 'warning', error: aggregateTone(metricCell(r, m)!) === 'negative', unset: aggregateTone(metricCell(r, m)!) === 'default' }">
                {{ aggregateValueLabel(metricCell(r, m)!) }}
              </span>
              <span v-else class="muted">–</span>
            </td>
            <td class="num mono">{{ r.itemCount }}</td>
            <td class="muted mono">{{ formatDateTime(r.createdAt) }}</td>
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
        <button type="button" class="page-btn" :disabled="page <= 1" @click="page -= 1">Prev</button>
        <span class="muted mono">Page {{ page }} / {{ pageCount }}</span>
        <button type="button" class="page-btn" :disabled="page >= pageCount" @click="page += 1">Next</button>
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
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search {
  width: 260px;
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
.page-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.page-btn:hover:not(:disabled) {
  background: var(--mt-soft);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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
