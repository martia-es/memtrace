<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import type { DatasetDto } from "@contract";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import { itemsFromCsv } from "../dataset-draft";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import PageHeader from "../components/PageHeader.vue";
import SegmentedControl from "../components/SegmentedControl.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "../components/Button.vue";
import DataTable from "../components/DataTable.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";
import { t, tp } from "../i18n";

const api = useTraceApi();
const router = useRouter();
const $q = useQuasar();

const datasets = useAsync((signal) => api.listDatasets(signal));
void datasets.run();

// vista (ficheros o lista): una preferencia de la persona, no un dato; si el navegador no deja guardarla, se usa la de por defecto
const VIEW_KEY = "mt.datasets.view";
type View = "grid" | "list";
function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}
const view = ref<View>(loadView());
function setView(next: unknown) {
  view.value = next === "list" ? "list" : "grid";
  try {
    localStorage.setItem(VIEW_KEY, view.value);
  } catch {
    /* sin almacenamiento: la vista vale solo para esta sesión */
  }
}
const VIEW_OPTIONS = [
  { value: "grid", get label() { return t("datasetsPage.files"); } },
  { value: "list", get label() { return t("datasetsPage.list"); } },
];

const search = ref("");
// el más recientemente editado primero, como en un explorador de ficheros
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = [...(datasets.data.value?.items ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return !q ? all : all.filter((d) => d.name.toLowerCase().includes(q));
});

function openDataset(datasetId: string) {
  router.push({ name: "dataset", params: { datasetId } });
}

function notifyError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : t("datasetsPage.unknown_error");
  $q.notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
}

const plural = (n: number, key: "versions" | "runs" | "items" | "rows") => tp(`datasetsPage.${key}`, n);
const versionLabel = (d: DatasetDto) => `v${d.latestVersionMajor}.${d.latestVersionMinor}`;
const meta = (d: DatasetDto) => `${plural(d.itemCount, "items")} · ${plural(d.runCount, "runs")}`;

/** Miniatura de hoja de cálculo: 5 filas × 2 columnas, con algunas celdas rellenas según las filas que tenga de verdad. */
function thumbCells(d: DatasetDto): boolean[] {
  return Array.from({ length: 10 }, (_, i) => Math.floor(i / 2) < Math.min(5, d.itemCount));
}

// ---- create dataset ----
const showCreateModal = ref(false);
const newDatasetName = ref("");
const creating = ref(false);
async function createDataset() {
  if (!newDatasetName.value.trim()) return;
  creating.value = true;
  try {
    const dataset = await api.createDataset(newDatasetName.value.trim());
    newDatasetName.value = "";
    showCreateModal.value = false;
    await datasets.run();
    router.push({ name: "dataset", params: { datasetId: dataset.id } });
  } catch (error) {
    notifyError(t("datasetsPage.could_not_create_dataset"), error);
  } finally {
    creating.value = false;
  }
}

// ---- crear un dataset soltando un .csv ----
const dragging = ref(false);
const importing = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

async function importFile(file: File) {
  if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
    notifyError(t("datasetsPage.could_not_import"), new Error(t("datasetsPage.name_is_not_a_csv_file", { name: file.name })));
    return;
  }
  importing.value = true;
  try {
    const { add, skipped } = itemsFromCsv(await file.text());
    if (add.length === 0) {
      notifyError(t("datasetsPage.could_not_import"), new Error(t("datasetsPage.the_file_has_no_rows_with")));
      return;
    }
    const dataset = await api.createDataset(file.name.replace(/\.[^.]+$/, ""));
    await api.commitDatasetChanges(dataset.id, { add });
    const note = skipped > 0 ? ` (${t("datasetsPage.rows_without_input_skipped", { rows: plural(skipped, "rows") })})` : "";
    $q.notify({ message: `${t("datasetsPage.created_name_with_items", { name: dataset.name, items: plural(add.length, "items") })}${note}`, color: "positive", timeout: 3500 });
    await datasets.run();
    openDataset(dataset.id);
  } catch (error) {
    notifyError(t("datasetsPage.could_not_import"), error);
  } finally {
    importing.value = false;
  }
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void importFile(file);
}
function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) void importFile(file);
}

// ---- borrar ----
const toDelete = ref<DatasetDto | null>(null);
const deleting = ref(false);
async function confirmDelete() {
  if (!toDelete.value) return;
  deleting.value = true;
  try {
    await api.deleteDataset(toDelete.value.id);
    toDelete.value = null;
    await datasets.run();
  } catch (error) {
    notifyError(t("datasetsPage.could_not_delete_dataset"), error);
  } finally {
    deleting.value = false;
  }
}
</script>

<template>
  <div
    class="page"
    :class="{ dragging }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.self.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <PageHeader :crumbs="[{ label: 'Evaluations' }, { label: 'Datasets' }]" icon="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" :title="t('datasetsPage.datasets')">
      <Button variant="primary" @click="showCreateModal = true" class="mt-new">{{ t("datasetsPage.new_dataset") }}</Button>
    </PageHeader>

    <!-- la barra superior solo lleva la acción principal: buscar y cambiar la vista no deben comerse la miga de pan -->
    <div class="toolbar">
      <TextInput type="search" v-model="search" :placeholder="t('datasetsPage.filter_by_name')" class="search" />
      <SegmentedControl :options="VIEW_OPTIONS" :model-value="view" size="sm" :aria-label="t('datasetsPage.view')" @update:model-value="setView" />
    </div>

    <input ref="fileInput" type="file" accept=".csv,.tsv,.txt,text/csv" class="file-input" :aria-label="t('datasetsPage.choose_a_csv_file')" @change="onPick" />

    <ErrorBanner v-if="datasets.error.value" :error="datasets.error.value" @retry="datasets.run()" />
    <LoadingState v-else-if="datasets.loading.value && !datasets.data.value" size="lg" />
    <EmptyState v-else-if="(datasets.data.value?.items.length ?? 0) === 0" icon="science" :title="t('datasetsPage.no_datasets_yet')">
      {{ t("datasetsPage.create_one_with_new_dataset_drop") + " " }}<code>{{ t("datasetsPage.csv") }}</code>{{ " " + t("datasetsPage.here_or_upload_one_from") + " " }}<code>memtrace.eval.run_experiment(data="…")</code>.
    </EmptyState>
    <EmptyState v-else-if="filtered.length === 0" icon="search_off" :title="t('datasetsPage.no_matches')">{{ t("datasetsPage.try_a_different_search") }}</EmptyState>

    <!-- ficheros -->
    <div v-else-if="view === 'grid'" class="files" data-testid="datasets-grid">
      <div v-for="d in filtered" :key="d.id" class="file" :data-testid="`dataset-file-${d.name}`">
        <button type="button" class="file-open" :aria-label="t('datasetsPage.open_name', { name: d.name })" @click="openDataset(d.id)">
          <span class="thumb" aria-hidden="true">
            <span class="sheet">
              <span class="sheet-head"></span>
              <span v-for="(filled, i) in thumbCells(d)" :key="i" class="sheet-cell" :class="{ filled }"></span>
            </span>
          </span>
          <span class="file-body">
            <span class="file-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
              <span class="file-name">{{ d.name }}</span>
              <span class="version mono">{{ versionLabel(d) }}</span>
            </span>
            <span class="file-meta muted">{{ meta(d) }}</span>
            <span class="file-meta muted">{{ t("datasetsPage.edited_when", { when: formatDateTime(d.updatedAt) }) }}</span>
          </span>
        </button>
        <Button variant="icon" size="sm" class="file-delete" :aria-label="t('datasetsPage.delete_name2', { name: d.name })" :title="t('datasetsPage.delete_name2', { name: d.name })" @click="toDelete = d">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
        </Button>
      </div>

      <button type="button" class="file drop" :disabled="importing" @click="fileInput?.click()">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>
        <strong>{{ importing ? t("datasetsPage.importing") : t("datasetsPage.drop_a_csv_here") }}</strong>
        <span>{{ t("datasetsPage.or_click_to_choose_one_it") }}</span>
      </button>
    </div>

    <!-- lista -->
    <Card padding="none" block v-else class="table-card">
      <DataTable class="datasets" sticky nowrap>
        <thead>
          <tr>
            <th>{{ t("datasetsPage.dataset") }}</th>
            <th class="num">{{ t("datasetsPage.version") }}</th>
            <th class="num">{{ t("datasetsPage.items") }}</th>
            <th class="num">{{ t("datasetsPage.runs") }}</th>
            <th>{{ t("datasetsPage.edited") }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filtered" :key="d.id" class="dataset-row" tabindex="0" @click="openDataset(d.id)" @keydown.enter="openDataset(d.id)">
            <td class="name">{{ d.name }}</td>
            <td class="num mono">{{ versionLabel(d) }}</td>
            <td class="num mono">{{ d.itemCount }}</td>
            <td class="num mono">{{ d.runCount }}</td>
            <td class="muted mono">{{ formatDateTime(d.updatedAt) }}</td>
            <td class="num">
              <Button variant="icon" size="sm" :aria-label="t('datasetsPage.delete_name2', { name: d.name })" :title="t('datasetsPage.delete_name2', { name: d.name })" @click.stop="toDelete = d">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" /></svg>
              </Button>
            </td>
          </tr>
        </tbody>
      </DataTable>
    </Card>

    <p class="hint muted">
      {{ t("datasetsPage.a_dataset_is_a_set_of") + " " }}<strong>{{ t("datasetsPage.version2") }}</strong>{{ " " + t("datasetsPage.see_the_versions_tab_inside_each") }}
    </p>

    <div v-if="dragging" class="drop-overlay" aria-hidden="true">{{ t("datasetsPage.drop_a_csv_to_create_a") }}</div>

    <Modal v-if="showCreateModal" :title="t('datasetsPage.new_dataset2')" @close="showCreateModal = false">
      <form class="modal-form" @submit.prevent="createDataset">
        <TextInput v-model="newDatasetName" :placeholder="t('datasetsPage.dataset_name')" autofocus />
        <Button variant="primary" type="submit" :disabled="creating || !newDatasetName.trim()">{{ t("datasetsPage.create") }}</Button>
      </form>
    </Modal>

    <Modal v-if="toDelete" :title="t('datasetsPage.delete_name', { name: toDelete.name })" @close="toDelete = null">
      <div class="modal-form">
        <p class="muted confirm">
          {{ t("datasetsPage.this_removes_the_dataset_with_its", { versions: plural(toDelete.versionCount, "versions"), runs: plural(toDelete.runCount, "runs") }) }}
        </p>
        <Button variant="danger" :disabled="deleting" @click="confirmDelete">{{ deleting ? t("datasetsPage.deleting") : t("datasetsPage.delete_dataset") }}</Button>
      </div>
    </Modal>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
  overflow: auto;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search {
  width: 260px;
}
.file-input {
  display: none;
}
.hint {
  margin: 0;
  font-size: 12.5px;
}
.muted {
  color: var(--mt-muted);
}

/* ---- ficheros ---- */
.files {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 14px;
}
.file {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  overflow: hidden;
}
.file:hover,
.file:focus-within {
  border-color: var(--mt-accent);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--mt-accent) 16%, transparent);
}
.file-open {
  display: flex;
  flex-direction: column;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.file-open:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: -2px;
}
.thumb {
  height: 112px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mt-soft-2);
  border-bottom: 1px solid var(--mt-line-2);
}
.sheet {
  width: 118px;
  height: 76px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1.2fr repeat(5, 1fr);
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: 4px;
  overflow: hidden;
}
.sheet-head {
  grid-column: 1 / 3;
  background: var(--mt-soft);
}
.sheet-cell {
  border-right: 1px solid var(--mt-line-2);
  border-bottom: 1px solid var(--mt-line-2);
}
.sheet-cell.filled {
  background: color-mix(in srgb, var(--mt-accent) 10%, transparent);
}
.file-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px 12px;
  min-width: 0;
}
.file-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--mt-accent);
  min-width: 0;
}
.file-name {
  flex: 1;
  min-width: 0;
  color: var(--mt-ink);
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.version {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--mt-soft);
  font-size: 11px;
  color: var(--mt-ink);
}
.file-meta {
  font-size: 11.5px;
}
.file-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
}
.file:hover .file-delete,
.file:focus-within .file-delete {
  opacity: 1;
}
.file.drop {
  min-height: 190px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  border: 1.5px dashed var(--mt-accent);
  background: var(--mt-soft-2);
  color: var(--mt-accent);
  font: inherit;
  font-size: 12px;
  text-align: center;
  cursor: pointer;
}
.file.drop strong {
  font-size: 13px;
}
.file.drop:disabled {
  cursor: progress;
  opacity: 0.7;
}

/* ---- lista ---- */
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.num {
  text-align: right;
}
.name {
  font-weight: 800;
}
.dataset-row {
  cursor: pointer;
}
.dataset-row:hover,
.dataset-row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}

/* ---- arrastrar un .csv ---- */
.drop-overlay {
  position: absolute;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed var(--mt-accent);
  border-radius: var(--mt-radius-lg);
  background: color-mix(in srgb, var(--mt-card) 88%, transparent);
  color: var(--mt-accent);
  font-size: 15px;
  font-weight: 800;
  pointer-events: none;
}

/* ---- modales ---- */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.confirm {
  margin: 0;
}
</style>
