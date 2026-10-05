<script setup lang="ts">
import type { RunListItemDto } from "@contract";
import { computed, ref } from "vue";
import type { RangeParams } from "@/application/trace-api";
import { selectOfflineRuns } from "../offline-eval-chart-option";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import EmptyState from "./EmptyState.vue";
import ErrorBanner from "./ErrorBanner.vue";
import Select from "./Select.vue";
import OfflineCompareView from "./OfflineCompareView.vue";
import OfflineRunView from "./OfflineRunView.vue";
import OfflineTrendView from "./OfflineTrendView.vue";

const props = defineProps<{ range: RangeParams; /** baseline and candidate to compare, from the Evaluations run list */ compareIds?: [string, string] | null }>();

const api = useTraceApi();

const runs = useAsync((signal) => api.listRuns(signal));
void runs.run();

const datasetId = ref<string | null>(null);
const view = ref<"trend" | "run" | "compare">(props.compareIds ? "compare" : "trend");
const VIEWS = [
  { name: "trend", label: "Overview" },
  { name: "run", label: "Run detail" },
  { name: "compare", label: "Compare runs" },
] as const;
const runId = ref<string | null>(null);

const ALL_DATASETS = "__all__";
const datasetOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const r of runs.data.value?.items ?? []) seen.set(r.datasetId, r.datasetName);
  return [{ label: "All datasets", value: ALL_DATASETS }, ...[...seen.entries()].map(([value, label]) => ({ label, value }))];
});
const datasetSelection = computed({
  get: () => datasetId.value ?? ALL_DATASETS,
  set: (v: string) => (datasetId.value = v === ALL_DATASETS ? null : v),
});

/** Tendencia: respeta el rango de la página. Run/Compare: todas las runs completadas, para poder elegir una antigua como baseline. */
const inRange = computed(() => selectOfflineRuns(runs.data.value?.items ?? [], props.range, datasetId.value));
const allCompleted = computed(() => selectOfflineRuns(runs.data.value?.items ?? [], { from: new Date(0).toISOString(), to: new Date(8.64e15).toISOString() }, datasetId.value));

function openRun(run: RunListItemDto) {
  runId.value = run.id;
  view.value = "run";
}
</script>

<template>
  <div class="offline">
    <header class="head">
      <div class="titles">
        <h2>Offline evaluations</h2>
        <p class="sub">Results of <code>run_experiment</code> against MemTrace datasets. Only completed runs are shown, so a partial upload never looks like a regression.</p>
      </div>
      <div class="filters">
        <label class="field">
          <span class="field-label">Dataset</span>
          <Select v-model="datasetSelection" :options="datasetOptions" />
        </label>
      </div>
    </header>

    <nav class="tabs" aria-label="Offline evaluation views">
      <button v-for="v in VIEWS" :key="v.name" type="button" class="tab" :class="{ active: view === v.name }" :aria-current="view === v.name ? 'page' : undefined" @click="view = v.name">
        {{ v.label }}
      </button>
    </nav>

    <ErrorBanner v-if="runs.error.value" :error="runs.error.value" @retry="runs.run()" />
    <div v-else-if="runs.loading.value && !runs.data.value" class="loading-box"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="!allCompleted.length" icon="science" title="No offline evaluation runs">No completed runs yet. Run <code>run_experiment</code> against a MemTrace dataset to see them here.</EmptyState>

    <template v-else>
      <OfflineTrendView v-if="view === 'trend'" :runs="inRange" @open-run="openRun" />
      <OfflineRunView v-else-if="view === 'run'" :runs="allCompleted" :run-id="runId" @update:run-id="runId = $event" />
      <OfflineCompareView v-else :runs="allCompleted" :initial-ids="compareIds ?? null" />
    </template>
  </div>
</template>

<style scoped>
.offline { display: flex; flex-direction: column; gap: 18px; font-family: var(--mt-sans); }
.head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.titles h2 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.02em; }
.sub { margin: 4px 0 0; color: var(--mt-muted); font-size: 13px; max-width: 680px; }
.sub code { font-family: var(--mt-mono); font-size: 12px; background: var(--mt-soft); padding: 1px 5px; border-radius: var(--mt-radius-sm); }
.filters { min-width: 220px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { color: var(--mt-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--mt-line); }
.tab { position: relative; padding: 10px 14px; border: 0; background: none; color: var(--mt-muted); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.tab:hover { color: var(--mt-ink); }
.tab.active { color: var(--mt-ink); }
.tab.active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--mt-accent); border-radius: 2px; }
.loading-box { display: flex; justify-content: center; align-items: center; min-height: 240px; }
</style>
