<script setup lang="ts">
import type { DatasetRunSummaryDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 20;

const api = useTraceApi();
const route = useRoute();
const router = useRouter();
const datasetId = computed(() => route.params.datasetId as string);

// no hay endpoint de "un solo dataset" todavía: se reutiliza el listado (pocas filas) para el nombre a mostrar.
const datasets = useAsync((signal) => api.listDatasets(signal));
void datasets.run();
const datasetName = computed(() => datasets.data.value?.items.find((d) => d.id === datasetId.value)?.name ?? datasetId.value);

const runs = useAsync((signal) => api.listDatasetRuns(datasetId.value, signal));
void runs.run();

const search = ref("");
const page = ref(1);
watch(search, () => (page.value = 1));

const metricNames = computed(() => {
  const names = new Set<string>();
  for (const r of runs.data.value?.items ?? []) for (const a of r.aggregates) names.add(a.name);
  return [...names].sort();
});

const filtered = computed(() => {
  const all = runs.data.value?.items ?? [];
  const q = search.value.trim().toLowerCase();
  return !q ? all : all.filter((r) => r.name.toLowerCase().includes(q));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const items = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function metricCell(r: DatasetRunSummaryDto, metric: string): ScoreAggregateDto | null {
  return r.aggregates.find((a) => a.name === metric) ?? null;
}

function openRun(runId: string) {
  router.push({ name: "dataset-run", params: { datasetId: datasetId.value, runId } });
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Evaluation', to: { name: 'datasets' } }, { label: datasetName }]" icon="science" :title="datasetName">
      <div class="actions">
        <q-input v-model="search" dense outlined placeholder="Filter by run name…" class="search" clearable>
          <template #prepend><q-icon name="search" size="18px" /></template>
        </q-input>
      </div>
    </PageHeader>

    <p class="hint muted">Cada fila es una vez que se corrió este dataset contra tu agente (<code>run_experiment(..., name="…")</code>). Haz click en una para ver el detalle por item.</p>

    <ErrorBanner v-if="runs.error.value" :error="runs.error.value" @retry="runs.run()" />
    <div v-else-if="runs.loading.value && !runs.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(runs.data.value?.items.length ?? 0) === 0" icon="playlist_add_check" title="No runs yet">
      Corre <code>run_experiment(data="{{ datasetId }}", …)</code> desde tu script.
    </EmptyState>
    <EmptyState v-else-if="items.length === 0" icon="search_off" title="No matches">Try a different search.</EmptyState>

    <div v-else class="mt-card table-card">
      <table class="runs">
        <thead>
          <tr>
            <th>Run</th>
            <th v-for="m in metricNames" :key="m" class="num">{{ m }}</th>
            <th class="num">Items</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in items" :key="r.id" class="row" tabindex="0" @click="openRun(r.id)" @keydown.enter="openRun(r.id)">
            <td class="name">{{ r.name }}</td>
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
  gap: 10px;
  padding: 16px;
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
  padding: 8px 12px;
  background: var(--mt-card, #fff);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.num {
  text-align: right;
}
.name {
  font-weight: 600;
}
.row {
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
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
</style>
