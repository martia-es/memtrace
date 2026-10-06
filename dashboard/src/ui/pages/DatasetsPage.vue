<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { formatDateTime } from "@/domain/format";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

const api = useTraceApi();
const router = useRouter();
const $q = useQuasar();

const datasets = useAsync((signal) => api.listDatasets(signal));
void datasets.run();

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = datasets.data.value?.items ?? [];
  return !q ? all : all.filter((d) => d.name.toLowerCase().includes(q));
});

function openDataset(datasetId: string) {
  router.push({ name: "dataset", params: { datasetId } });
}

function notifyError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown error";
  $q.notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
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
    notifyError("Could not create dataset", error);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Evaluations' }, { label: 'Datasets' }]" icon="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" title="Datasets">
      <div class="actions">
        <TextInput type="search" v-model="search" placeholder="Filter by name…" class="search" />
        <button type="button" class="primary-btn mt-new" @click="showCreateModal = true">+ New dataset</button>
      </div>
    </PageHeader>

    <p class="hint muted">
      A dataset is a set of curated examples to evaluate your agent. Every change to its items creates a new <strong>version</strong> (see the Versions tab inside each dataset):
      past runs keep pointing at the exact version they ran against.
    </p>

    <ErrorBanner v-if="datasets.error.value" :error="datasets.error.value" @retry="datasets.run()" />
    <div v-else-if="datasets.loading.value && !datasets.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(datasets.data.value?.items.length ?? 0) === 0" icon="science" title="No datasets yet">
      Create one with "New dataset", or upload one from <code>memtrace.eval.run_experiment(data="…")</code>.
    </EmptyState>
    <EmptyState v-else-if="filtered.length === 0" icon="search_off" title="No matches">Try a different search.</EmptyState>

    <div v-else class="mt-card table-card">
      <table class="datasets">
        <thead>
          <tr>
            <th>Dataset</th>
            <th class="num">Version</th>
            <th class="num">Runs</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filtered" :key="d.id" class="dataset-row" tabindex="0" @click="openDataset(d.id)" @keydown.enter="openDataset(d.id)">
            <td class="name">{{ d.name }}</td>
            <td class="num mono">v{{ d.latestVersionMajor }}.{{ d.latestVersionMinor }}</td>
            <td class="num mono">{{ d.runCount }}</td>
            <td class="muted mono">{{ formatDateTime(d.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="showCreateModal" title="New dataset" @close="showCreateModal = false">
      <form class="modal-form" @submit.prevent="createDataset">
        <TextInput v-model="newDatasetName" placeholder="Dataset name" autofocus />
        <button type="submit" class="primary-btn" :disabled="creating || !newDatasetName.trim()">Create</button>
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
.datasets {
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
.dataset-row {
  cursor: pointer;
}
.dataset-row:hover,
.dataset-row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}

/* ---- modal ---- */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-btn:not(:disabled):hover {
  opacity: 0.9;
}
</style>
