<script setup lang="ts">
import type { RunListItemDto } from "@contract";
import { computed, ref } from "vue";
import type { RangeParams } from "@/application/trace-api";
import { selectOfflineRuns } from "../offline-eval-chart-option";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import EmptyState from "./EmptyState.vue";
import ErrorBanner from "./ErrorBanner.vue";
import FilterPill from "./FilterPill.vue";
import OfflineCompareView from "./OfflineCompareView.vue";
import OfflineRunView from "./OfflineRunView.vue";
import OfflineTrendView from "./OfflineTrendView.vue";

const props = defineProps<{ range: RangeParams }>();

const api = useTraceApi();

const runs = useAsync((signal) => api.listRuns(signal));
void runs.run();

const datasetId = ref<string | null>(null);
const view = ref<"trend" | "run" | "compare">("trend");
const runId = ref<string | null>(null);

const datasetOptions = computed(() => {
  const seen = new Map<string, string>();
  for (const r of runs.data.value?.items ?? []) seen.set(r.datasetId, r.datasetName);
  return [...seen.entries()].map(([value, label]) => ({ label, value }));
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
    <div class="toolbar">
      <q-btn-toggle v-model="view" no-caps dense unelevated toggle-color="primary" :options="[{ label: 'Trend', value: 'trend' }, { label: 'Run', value: 'run' }, { label: 'Compare', value: 'compare' }]" />
      <FilterPill label="Dataset" :model-value="datasetId ?? undefined" :options="datasetOptions" all-label="All" @update:model-value="datasetId = $event ?? null" />
      <p class="hint">Completed offline evaluation runs. Runs still uploading are left out so a partial upload never looks like a regression.</p>
    </div>

    <ErrorBanner v-if="runs.error.value" :error="runs.error.value" @retry="runs.run()" />
    <div v-else-if="runs.loading.value && !runs.data.value" class="loading-box"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="!allCompleted.length" icon="science" title="No offline evaluation runs">No completed runs yet. Run <code>run_experiment</code> against a MemTrace dataset to see them here.</EmptyState>

    <template v-else>
      <OfflineTrendView v-if="view === 'trend'" :runs="inRange" @open-run="openRun" />
      <OfflineRunView v-else-if="view === 'run'" :runs="allCompleted" :run-id="runId" @update:run-id="runId = $event" />
      <OfflineCompareView v-else :runs="allCompleted" />
    </template>
  </div>
</template>

<style scoped>
.offline { display: flex; flex-direction: column; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.hint { margin: 0; font-size: 12px; opacity: 0.7; }
.loading-box { display: flex; justify-content: center; align-items: center; min-height: 240px; }
</style>
