<script setup lang="ts">
import type { DatasetDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterPill from "../components/FilterPill.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
  { label: "Passing", value: "passing" },
  { label: "Needs attention", value: "failing" },
];

const api = useTraceApi();
const router = useRouter();

const datasets = useAsync((signal) => api.listDatasets(signal));
void datasets.run();

const search = ref("");
const status = ref<string | undefined>(undefined);
const page = ref(1);
watch([search, status], () => (page.value = 1));

// columnas dinámicas: una por cada nombre de evaluador visto en algún dataset (p.ej. exact_match, contains)
const metricNames = computed(() => {
  const names = new Set<string>();
  for (const d of datasets.data.value?.items ?? []) for (const a of d.lastRun?.aggregates ?? []) names.add(a.name);
  return [...names].sort();
});

function datasetStatus(d: DatasetDto): "passing" | "failing" | "unknown" {
  const aggregates = d.lastRun?.aggregates ?? [];
  if (aggregates.length === 0) return "unknown";
  if (aggregates.some((a) => aggregateTone(a) === "negative")) return "failing";
  if (aggregates.every((a) => aggregateTone(a) === "positive")) return "passing";
  return "unknown";
}

const filtered = computed(() => {
  const all = datasets.data.value?.items ?? [];
  const q = search.value.trim().toLowerCase();
  return all.filter((d) => (!q || d.name.toLowerCase().includes(q)) && (!status.value || datasetStatus(d) === status.value));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const items = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

function metricCell(d: DatasetDto, metric: string): ScoreAggregateDto | null {
  return d.lastRun?.aggregates.find((a) => a.name === metric) ?? null;
}

function openDataset(datasetId: string) {
  router.push({ name: "dataset", params: { datasetId } });
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Evaluation' }]" icon="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" title="Evaluation">
      <div class="actions">
        <FilterPill label="Status" :model-value="status" :options="STATUS_OPTIONS" all-label="All" @update:model-value="status = $event" />
        <q-input v-model="search" dense outlined placeholder="Filter by dataset name…" class="search" clearable>
          <template #prepend><q-icon name="search" size="18px" /></template>
        </q-input>
      </div>
    </PageHeader>

    <ErrorBanner v-if="datasets.error.value" :error="datasets.error.value" @retry="datasets.run()" />
    <div v-else-if="datasets.loading.value && !datasets.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(datasets.data.value?.items.length ?? 0) === 0" icon="science" title="No datasets yet">
      Sube un dataset desde <code>memtrace.eval.run_experiment(data="…")</code> y aparecerá aquí.
    </EmptyState>
    <EmptyState v-else-if="items.length === 0" icon="search_off" title="No matches">Try a different search or status.</EmptyState>

    <div v-else class="mt-card table-card">
      <table class="datasets">
        <thead>
          <tr>
            <th>Dataset</th>
            <th v-for="m in metricNames" :key="m" class="num">{{ m }}</th>
            <th>Generated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in items" :key="d.id" class="row" tabindex="0" @click="openDataset(d.id)" @keydown.enter="openDataset(d.id)">
            <td class="name">{{ d.name }}</td>
            <td v-for="m in metricNames" :key="m" class="num">
              <span v-if="metricCell(d, m)" class="mt-pill" :class="{ ok: aggregateTone(metricCell(d, m)!) === 'positive', warn: aggregateTone(metricCell(d, m)!) === 'warning', error: aggregateTone(metricCell(d, m)!) === 'negative', unset: aggregateTone(metricCell(d, m)!) === 'default' }">
                {{ aggregateValueLabel(metricCell(d, m)!) }}
              </span>
              <span v-else class="muted">–</span>
            </td>
            <td class="muted mono">{{ formatDateTime(d.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="items.length > 0" class="pager">
      <span class="muted">{{ filtered.length }} dataset{{ filtered.length === 1 ? "" : "s" }}</span>
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
.datasets {
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
