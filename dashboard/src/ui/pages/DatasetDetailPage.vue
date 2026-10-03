<script setup lang="ts">
import type { DatasetRunSummaryDto, DatasetVersionDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import DatasetVersionDiffModal from "../components/DatasetVersionDiffModal.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import DatasetItemsEditor from "../components/DatasetItemsEditor.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 20;

const api = useTraceApi();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const datasetId = computed(() => route.params.datasetId as string);

const dataset = useAsync((signal) => api.getDataset(datasetId.value, signal));
void dataset.run();

function notifyError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown error";
  $q.notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
}

const activeTab = ref<"items" | "versions" | "runs">("items");

// ---- versions (ADR-032): historial puramente informativo, nunca se crean a mano ----
const versions = useAsync((signal) => api.listDatasetVersions(datasetId.value, signal));
void versions.run();
const latestVersion = computed(() => versions.data.value?.items[0] ?? null);

// cada add/edit/delete de item crea su propia versión sola en el servidor: aquí solo refrescamos
// items + historial de versiones + el dataset (para la cabecera) después de cada mutación.
async function afterItemMutation() {
  await Promise.all([items.run(), versions.run(), dataset.run()]);
}

// qué cambió exactamente en una versión del historial: incluye los tombstones de items borrados
// ahí (quién, cuándo) — la respuesta directa a "¿cómo sé que se borró un item?" (ADR-032 follow-up).
// versión abierta en el modal de detalle/comparación (ADR-033)
const inspectedVersion = ref<DatasetVersionDto | null>(null);

// ---- items (siempre la última versión) ----
const items = useAsync((signal) => api.listDatasetItems(datasetId.value, signal));
void items.run();

// ---- runs ----
const runs = useAsync((signal) => api.listDatasetRuns(datasetId.value, signal));
void runs.run();

const runSearch = ref("");
const runPage = ref(1);
watch(runSearch, () => (runPage.value = 1));

const runMetricNames = computed(() => {
  const names = new Set<string>();
  for (const r of runs.data.value?.items ?? []) for (const a of r.aggregates) names.add(a.name);
  return [...names].sort();
});

const filteredRuns = computed(() => {
  const all = runs.data.value?.items ?? [];
  const q = runSearch.value.trim().toLowerCase();
  return !q ? all : all.filter((r) => r.name.toLowerCase().includes(q));
});
const runPageCount = computed(() => Math.max(1, Math.ceil(filteredRuns.value.length / PAGE_SIZE)));
const pagedRuns = computed(() => filteredRuns.value.slice((runPage.value - 1) * PAGE_SIZE, runPage.value * PAGE_SIZE));

function runMetricCell(r: DatasetRunSummaryDto, metric: string): ScoreAggregateDto | null {
  return r.aggregates.find((a) => a.name === metric) ?? null;
}

function openRun(runId: string) {
  router.push({ name: "dataset-run", params: { datasetId: datasetId.value, runId } });
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Datasets', to: { name: 'datasets' } }, { label: dataset.data.value?.name ?? datasetId }]" icon="science" :title="dataset.data.value?.name ?? datasetId" />

    <ErrorBanner v-if="dataset.error.value" :error="dataset.error.value" @retry="dataset.run()" />
    <template v-else>
      <q-tabs v-model="activeTab" class="tabs" active-color="primary" indicator-color="primary" align="left" no-caps dense>
        <q-tab name="items" label="Items" />
        <q-tab name="versions" label="Versions" />
        <q-tab name="runs" label="Runs" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated keep-alive class="tab-panels">
        <!-- Items -->
        <q-tab-panel name="items" class="tab-panel">
          <p class="hint muted">Current version: v{{ latestVersion?.major ?? 1 }}.{{ latestVersion?.minor ?? 0 }} — edita directamente en la tabla; al pulsar Publish todos tus cambios se guardan como <b>una sola versión</b>.</p>
          <ErrorBanner v-if="items.error.value" :error="items.error.value" @retry="items.run()" />
          <div v-else-if="items.loading.value && !items.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
          <DatasetItemsEditor v-else :dataset-id="datasetId" :items="items.data.value?.items ?? []" :version="latestVersion" @published="afterItemMutation" />
        </q-tab-panel>

        <!-- Versions: historial de solo lectura, generado automáticamente (ADR-032) -->
        <q-tab-panel name="versions" class="tab-panel">
          <p class="hint muted">Cada vez que publicas cambios en Items se crea una versión sola — si añades o borras items sube la major, si solo editas contenido sube la minor. Pulsa ⓘ para ver qué cambió y compararla con cualquier versión anterior.</p>
          <ErrorBanner v-if="versions.error.value" :error="versions.error.value" @retry="versions.run()" />
          <div v-else-if="versions.loading.value && !versions.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
          <div v-else class="mt-card table-card">
            <table class="items">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Change</th>
                  <th>Diff</th>
                  <th class="num">Items</th>
                  <th>By</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in versions.data.value?.items ?? []" :key="v.id">
                  <td class="name">v{{ v.major }}.{{ v.minor }}</td>
                  <td class="muted">{{ v.note ?? "–" }}</td>
                  <td class="mono diff-counts">
                    <span v-if="v.addedCount + v.modifiedCount + v.removedCount === 0" class="muted">–</span>
                    <template v-else>
                      <span v-if="v.addedCount" class="added">+{{ v.addedCount }}</span>
                      <span v-if="v.modifiedCount" class="modified">~{{ v.modifiedCount }}</span>
                      <span v-if="v.removedCount" class="removed">−{{ v.removedCount }}</span>
                    </template>
                  </td>
                  <td class="num mono">{{ v.itemCount }}</td>
                  <td class="muted">{{ v.createdByEmail }}</td>
                  <td class="muted mono">{{ formatDateTime(v.createdAt) }}</td>
                  <td class="info-cell">
                    <button class="info-btn" type="button" :aria-label="`Details of v${v.major}.${v.minor}`" @click="inspectedVersion = v">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <DatasetVersionDiffModal
            v-if="inspectedVersion"
            :dataset-id="datasetId"
            :version="inspectedVersion"
            :versions="versions.data.value?.items ?? []"
            @close="inspectedVersion = null"
          />
        </q-tab-panel>

        <!-- Runs -->
        <q-tab-panel name="runs" class="tab-panel">
          <q-input v-model="runSearch" dense outlined placeholder="Filter by run name…" class="search" clearable>
            <template #prepend><q-icon name="search" size="18px" /></template>
          </q-input>
          <ErrorBanner v-if="runs.error.value" :error="runs.error.value" @retry="runs.run()" />
          <div v-else-if="runs.loading.value && !runs.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
          <EmptyState v-else-if="(runs.data.value?.items.length ?? 0) === 0" icon="playlist_add_check" title="No runs yet">
            Corre <code>run_experiment(data="{{ datasetId }}", …)</code> desde tu script.
          </EmptyState>
          <EmptyState v-else-if="pagedRuns.length === 0" icon="search_off" title="No matches">Try a different search.</EmptyState>
          <div v-else class="mt-card table-card">
            <table class="items">
              <thead>
                <tr>
                  <th>Run</th>
                  <th class="num">Version</th>
                  <th v-for="m in runMetricNames" :key="m" class="num">{{ m }}</th>
                  <th class="num">Items</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in pagedRuns" :key="r.id" class="run-row" tabindex="0" @click="openRun(r.id)" @keydown.enter="openRun(r.id)">
                  <td class="name">{{ r.name }}</td>
                  <td class="num mono">v{{ r.versionMajor }}.{{ r.versionMinor }} <span v-if="r.status === 'running'" class="mt-pill warn" title="Still receiving results, or the process stopped before finishing">running</span></td>
                  <td v-for="m in runMetricNames" :key="m" class="num">
                    <span v-if="runMetricCell(r, m)" class="mt-pill" :class="{ ok: aggregateTone(runMetricCell(r, m)!) === 'positive', warn: aggregateTone(runMetricCell(r, m)!) === 'warning', error: aggregateTone(runMetricCell(r, m)!) === 'negative', unset: aggregateTone(runMetricCell(r, m)!) === 'default' }">
                      {{ aggregateValueLabel(runMetricCell(r, m)!) }}
                    </span>
                    <span v-else class="muted">–</span>
                  </td>
                  <td class="num mono">{{ r.itemCount }}</td>
                  <td class="muted mono">{{ formatDateTime(r.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="pagedRuns.length > 0" class="pager">
            <span class="muted">{{ filteredRuns.length }} run{{ filteredRuns.length === 1 ? "" : "s" }}</span>
            <div class="pager-controls">
              <button type="button" class="page-btn" :disabled="runPage <= 1" @click="runPage -= 1">Prev</button>
              <span class="muted mono">Page {{ runPage }} / {{ runPageCount }}</span>
              <button type="button" class="page-btn" :disabled="runPage >= runPageCount" @click="runPage += 1">Next</button>
            </div>
          </div>
        </q-tab-panel>
      </q-tab-panels>
    </template>

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
.muted {
  color: var(--mt-muted);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.tabs {
  flex-shrink: 0;
}
.tab-panels {
  flex: 1;
  min-height: 0;
  background: transparent;
}
.tab-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 0;
}
.search {
  width: 260px;
}
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.items {
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
.cell {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.num {
  text-align: right;
}
.name {
  font-weight: 600;
}
.run-row {
  cursor: pointer;
}
.run-row:hover,
.run-row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.run-row.selected {
  background: var(--mt-soft);
}
.diff-counts {
  display: flex;
  gap: 8px;
}
.diff-counts .added {
  color: var(--mt-ok-ink);
}
.diff-counts .modified {
  color: var(--mt-warn-ink);
}
.diff-counts .removed {
  color: var(--mt-err-ink);
}
.info-cell {
  width: 40px;
  text-align: right;
}
.info-btn {
  display: inline-flex;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
}
.info-btn:hover {
  color: var(--mt-ink);
}
.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.icon-btn.danger:hover {
  color: var(--mt-error-ink, #c0392b);
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
