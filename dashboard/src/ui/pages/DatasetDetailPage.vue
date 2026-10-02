<script setup lang="ts">
import type { DatasetItemDto, DatasetRunSummaryDto, ScoreAggregateDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
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
const expandedVersionId = ref<string | null>(null);
const versionItems = useAsync((signal) => {
  if (!expandedVersionId.value) return Promise.resolve({ items: [] });
  return api.listDatasetVersionItemsWithDeleted(datasetId.value, expandedVersionId.value, signal);
});
function toggleVersionDetail(versionId: string) {
  expandedVersionId.value = expandedVersionId.value === versionId ? null : versionId;
  if (expandedVersionId.value) void versionItems.run();
}

// ---- items (siempre la última versión) ----
const items = useAsync((signal) => api.listDatasetItems(datasetId.value, signal));
void items.run();

const showItemModal = ref(false);
const editingItem = ref<DatasetItemDto | null>(null);
const itemInput = ref("");
const itemExpectedOutput = ref("");
const itemMetadata = ref("");
const savingItem = ref(false);

function openNewItemModal() {
  editingItem.value = null;
  itemInput.value = "";
  itemExpectedOutput.value = "";
  itemMetadata.value = "";
  showItemModal.value = true;
}

function openEditItemModal(item: DatasetItemDto) {
  editingItem.value = item;
  itemInput.value = typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2);
  itemExpectedOutput.value = item.expectedOutput == null ? "" : typeof item.expectedOutput === "string" ? item.expectedOutput : JSON.stringify(item.expectedOutput, null, 2);
  itemMetadata.value = item.metadata ? JSON.stringify(item.metadata, null, 2) : "";
  showItemModal.value = true;
}

function parseField(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

async function saveItem() {
  if (!itemInput.value.trim()) return;
  savingItem.value = true;
  try {
    const payload = {
      input: parseField(itemInput.value),
      expectedOutput: itemExpectedOutput.value.trim() ? parseField(itemExpectedOutput.value) : null,
      metadata: itemMetadata.value.trim() ? (parseField(itemMetadata.value) as Record<string, unknown>) : null,
    };
    if (editingItem.value) {
      await api.updateDatasetItem(datasetId.value, editingItem.value.id, payload);
    } else {
      await api.createDatasetItem(datasetId.value, payload);
    }
    showItemModal.value = false;
    await afterItemMutation();
  } catch (error) {
    notifyError("Could not save item", error);
  } finally {
    savingItem.value = false;
  }
}

async function deleteItem(item: DatasetItemDto) {
  try {
    await api.deleteDatasetItem(datasetId.value, item.id);
    await afterItemMutation();
  } catch (error) {
    notifyError("Could not delete item", error);
  }
}

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

      <q-tab-panels v-model="activeTab" animated class="tab-panels">
        <!-- Items -->
        <q-tab-panel name="items" class="tab-panel">
          <div class="items-toolbar">
            <span class="muted">Current version: v{{ latestVersion?.major ?? 1 }}.{{ latestVersion?.minor ?? 0 }} — editar aquí crea la siguiente versión sola (ver pestaña Versions).</span>
            <button type="button" class="ghost-btn" @click="openNewItemModal">Add item</button>
          </div>
          <ErrorBanner v-if="items.error.value" :error="items.error.value" @retry="items.run()" />
          <div v-else-if="items.loading.value && !items.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
          <EmptyState v-else-if="(items.data.value?.items.length ?? 0) === 0" icon="list_alt" title="No items yet">
            Add one manually, or upload items via <code>memtrace.eval</code>.
          </EmptyState>
          <div v-else class="mt-card table-card">
            <table class="items">
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Expected output</th>
                  <th>Added by</th>
                  <th>Last edited</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in items.data.value!.items" :key="item.id">
                  <td class="cell">{{ typeof item.input === "string" ? item.input : JSON.stringify(item.input) }}</td>
                  <td class="cell muted">{{ item.expectedOutput == null ? "–" : typeof item.expectedOutput === "string" ? item.expectedOutput : JSON.stringify(item.expectedOutput) }}</td>
                  <td class="muted">
                    {{ item.createdByEmail }}
                    <span class="mono">· {{ formatDateTime(item.createdAt) }}</span>
                  </td>
                  <td class="muted">
                    <template v-if="item.updatedByEmail">{{ item.updatedByEmail }} <span class="mono">· {{ formatDateTime(item.updatedAt!) }}</span></template>
                    <span v-else>–</span>
                  </td>
                  <td class="row-actions">
                    <button type="button" class="icon-btn" title="Edit" @click="openEditItemModal(item)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                    </button>
                    <button type="button" class="icon-btn danger" title="Delete" @click="deleteItem(item)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </q-tab-panel>

        <!-- Versions: historial de solo lectura, generado automáticamente (ADR-032) -->
        <q-tab-panel name="versions" class="tab-panel">
          <p class="hint muted">Cada cambio en Items crea su propia versión sola — añadir/borrar un item sube la versión major, editar uno sube la minor. Despliega una fila para ver sus items, incluidos los borrados ahí (quién y cuándo).</p>
          <ErrorBanner v-if="versions.error.value" :error="versions.error.value" @retry="versions.run()" />
          <div v-else-if="versions.loading.value && !versions.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
          <div v-else class="mt-card table-card">
            <table class="items">
              <thead>
                <tr>
                  <th></th>
                  <th>Version</th>
                  <th>Change</th>
                  <th class="num">Items</th>
                  <th>By</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="v in versions.data.value?.items ?? []" :key="v.id">
                  <tr class="row" tabindex="0" @click="toggleVersionDetail(v.id)" @keydown.enter="toggleVersionDetail(v.id)">
                    <td class="chevron-cell">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: expandedVersionId === v.id ? 'rotate(90deg)' : 'none' }"><path d="M9 6l6 6-6 6" /></svg>
                    </td>
                    <td class="name">v{{ v.major }}.{{ v.minor }}</td>
                    <td class="muted">{{ v.note ?? "–" }}</td>
                    <td class="num mono">{{ v.itemCount }}</td>
                    <td class="muted">{{ v.createdByEmail }}</td>
                    <td class="muted mono">{{ formatDateTime(v.createdAt) }}</td>
                  </tr>
                  <tr v-if="expandedVersionId === v.id">
                    <td colspan="6" class="version-detail">
                      <div v-if="versionItems.loading.value" class="loading small"><q-spinner size="20px" color="primary" /></div>
                      <table v-else class="items nested">
                        <thead>
                          <tr>
                            <th>Input</th>
                            <th>Status</th>
                            <th>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="item in versionItems.data.value?.items ?? []" :key="item.id" :class="{ deleted: item.deletedByEmail }">
                            <td class="cell">{{ typeof item.input === "string" ? item.input : JSON.stringify(item.input) }}</td>
                            <td>
                              <span v-if="item.deletedByEmail" class="mt-pill error">Deleted</span>
                              <span v-else-if="item.updatedByEmail" class="mt-pill warn">Edited</span>
                              <span v-else class="mt-pill ok">Added</span>
                            </td>
                            <td class="muted">
                              <template v-if="item.deletedByEmail">by {{ item.deletedByEmail }} · {{ formatDateTime(item.deletedAt!) }}</template>
                              <template v-else-if="item.updatedByEmail">by {{ item.updatedByEmail }} · {{ formatDateTime(item.updatedAt!) }}</template>
                              <template v-else>by {{ item.createdByEmail }} · {{ formatDateTime(item.createdAt) }}</template>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
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
                <tr v-for="r in pagedRuns" :key="r.id" class="row" tabindex="0" @click="openRun(r.id)" @keydown.enter="openRun(r.id)">
                  <td class="name">{{ r.name }}</td>
                  <td class="num mono">v{{ r.versionMajor }}.{{ r.versionMinor }}</td>
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

    <Modal v-if="showItemModal" :title="editingItem ? 'Edit item' : 'New item'" @close="showItemModal = false">
      <form class="modal-form" @submit.prevent="saveItem">
        <label class="field-label">Input</label>
        <textarea v-model="itemInput" class="text-area" rows="3" placeholder="Plain text or JSON" autofocus></textarea>
        <label class="field-label">Expected output (optional)</label>
        <textarea v-model="itemExpectedOutput" class="text-area" rows="2" placeholder="Plain text or JSON"></textarea>
        <label class="field-label">Metadata (optional JSON)</label>
        <textarea v-model="itemMetadata" class="text-area" rows="2" placeholder='{"source": "manual"}'></textarea>
        <button type="submit" class="primary-btn" :disabled="savingItem || !itemInput.trim()">{{ editingItem ? "Save" : "Add" }}</button>
      </form>
    </Modal>
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
.items-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12.5px;
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
.row {
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.row.selected {
  background: var(--mt-soft);
}
.chevron-cell {
  width: 24px;
  color: var(--mt-muted);
}
.chevron-cell svg {
  transition: transform 0.15s ease;
}
.version-detail {
  padding: 10px 12px 14px 36px;
  background: var(--mt-soft-2);
}
.items.nested {
  font-size: 12.5px;
}
.items.nested th {
  position: static;
  background: transparent;
  padding: 4px 10px;
}
.items.nested td {
  padding: 4px 10px;
  border-bottom: none;
}
.items.nested tr.deleted {
  opacity: 0.75;
}
.loading.small {
  display: flex;
  justify-content: center;
  padding: 10px;
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

.ghost-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.ghost-btn:hover:not(:disabled) {
  color: var(--mt-ink);
  border-color: var(--mt-accent);
}
.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ghost-btn.small {
  height: 26px;
  padding: 0 10px;
  font-size: 11.5px;
}

/* ---- modal ---- */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-label {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.text-area {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
  resize: vertical;
}
.text-area:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
}
.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
  margin-top: 4px;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-btn:not(:disabled):hover {
  opacity: 0.9;
}
</style>
