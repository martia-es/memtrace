<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import type { DatasetRunSummaryDto, DatasetVersionDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregatePillTone, aggregateValueLabel } from "@/domain/evaluation";
import DatasetVersionDiffModal from "../components/DatasetVersionDiffModal.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import DatasetItemsEditor from "../components/DatasetItemsEditor.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "../components/Button.vue";
import Pill from "../components/Pill.vue";
import Pagination from "../components/Pagination.vue";
import DataTable from "../components/DataTable.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";

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

      <q-tab-panels v-model="activeTab" keep-alive class="tab-panels">
        <!-- Items -->
        <q-tab-panel name="items" class="tab-panel">
          <p class="hint muted">Current version: v{{ latestVersion?.major ?? 1 }}.{{ latestVersion?.minor ?? 0 }} — edit directly in the table; when you press Publish, all your changes are saved as <b>a single version</b>.</p>
          <ErrorBanner v-if="items.error.value" :error="items.error.value" @retry="items.run()" />
          <LoadingState v-else-if="items.loading.value && !items.data.value" size="lg" />
          <DatasetItemsEditor v-else :dataset-id="datasetId" :items="items.data.value?.items ?? []" :version="latestVersion" @published="afterItemMutation" />
        </q-tab-panel>

        <!-- Versions: historial de solo lectura, generado automáticamente (ADR-032) -->
        <q-tab-panel name="versions" class="tab-panel">
          <p class="hint muted">Every time you publish changes in Items a version is created on its own — adding or removing items bumps the major, editing content only bumps the minor. Press ⓘ to see what changed and compare it with any earlier version.</p>
          <ErrorBanner v-if="versions.error.value" :error="versions.error.value" @retry="versions.run()" />
          <LoadingState v-else-if="versions.loading.value && !versions.data.value" size="lg" />
          <Card padding="none" block v-else class="table-card">
            <DataTable class="items" sticky nowrap>
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
            </DataTable>
          </Card>
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
          <TextInput type="search" v-model="runSearch" placeholder="Filter by run name…" class="search" />
          <ErrorBanner v-if="runs.error.value" :error="runs.error.value" @retry="runs.run()" />
          <LoadingState v-else-if="runs.loading.value && !runs.data.value" size="lg" />
          <EmptyState v-else-if="(runs.data.value?.items.length ?? 0) === 0" icon="playlist_add_check" title="No runs yet">
            Run <code>run_experiment(data="{{ datasetId }}", …)</code> from your script.
          </EmptyState>
          <EmptyState v-else-if="pagedRuns.length === 0" icon="search_off" title="No matches">Try a different search.</EmptyState>
          <Card padding="none" block v-else class="table-card">
            <DataTable class="items" sticky nowrap>
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
                  <td class="num mono">v{{ r.versionMajor }}.{{ r.versionMinor }} <Pill tone="warn" v-if="r.status === 'running'" title="Still receiving results, or the process stopped before finishing">running</Pill></td>
                  <td v-for="m in runMetricNames" :key="m" class="num">
                    <Pill v-if="runMetricCell(r, m)" :tone="aggregatePillTone(aggregateTone(runMetricCell(r, m)!))">
                      {{ aggregateValueLabel(runMetricCell(r, m)!) }}
                    </Pill>
                    <span v-else class="muted">–</span>
                  </td>
                  <td class="num mono">{{ r.itemCount }}</td>
                  <td class="muted mono">{{ formatDateTime(r.createdAt) }}</td>
                </tr>
              </tbody>
            </DataTable>
          </Card>
          <Pagination v-if="pagedRuns.length > 0" v-model:page="runPage" :page-count="runPageCount">{{ filteredRuns.length }} run{{ filteredRuns.length === 1 ? "" : "s" }}</Pagination>
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
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
.muted {
  color: var(--mt-muted);
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

</style>
