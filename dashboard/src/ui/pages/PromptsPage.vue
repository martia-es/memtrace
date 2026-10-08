<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime } from "@/domain/format";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import PageHeader from "../components/PageHeader.vue";
import TextInput from "../components/TextInput.vue";
import { useAsync } from "../composables/useAsync";
import { usePermissions } from "../composables/usePermissions";
import { usePromptApi } from "../composables/usePromptApi";

const api = usePromptApi();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const { can } = usePermissions();

const experimentId = computed(() => String(route.params.experimentId));
const showArchived = ref(false);
const prompts = useAsync((signal) => api.listForAgent(experimentId.value, showArchived.value, signal));
void prompts.run();

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  const all = prompts.data.value ?? [];
  return !q ? all : all.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
});

function open(promptId: string) {
  router.push({ name: "prompt", params: { experimentId: experimentId.value, promptId } });
}

// ---- create ----
const showCreate = ref(false);
const form = ref({ name: "", description: "", content: "", message: "" });
const creating = ref(false);
const fieldErrors = ref<Record<string, string>>({});
async function create() {
  creating.value = true;
  fieldErrors.value = {};
  try {
    const detail = await api.create(experimentId.value, { ...form.value, name: form.value.name.trim() });
    showCreate.value = false;
    form.value = { name: "", description: "", content: "", message: "" };
    open(detail.prompt.id);
  } catch (error) {
    const err = error as Error & { fields?: Record<string, string> };
    fieldErrors.value = err.fields ?? {};
    $q.notify({ message: `Could not create the prompt: ${describeApiError(err)}`, color: "negative", timeout: 4000 });
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Prompts' }, { label: 'Prompts' }]" icon="M4 6h16M4 12h16M4 18h10" title="Prompts">
      <div class="actions">
        <TextInput v-model="search" type="search" placeholder="Filter by name…" class="search" />
        <label class="archived-toggle"><input v-model="showArchived" type="checkbox" data-testid="show-archived" @change="prompts.run()" /> Show archived</label>
        <button v-if="can('prompt:write')" type="button" class="primary-btn" data-testid="new-prompt" @click="showCreate = true">+ New prompt</button>
      </div>
    </PageHeader>

    <p class="hint muted">
      Each save creates an immutable <strong>version</strong>. Tags such as <code>dev</code>, <code>pre</code> and <code>pro</code> point to the version that runs in each environment.
    </p>

    <ErrorBanner v-if="prompts.error.value" :error="prompts.error.value" @retry="prompts.run()" />
    <div v-else-if="prompts.loading.value && !prompts.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(prompts.data.value?.length ?? 0) === 0" icon="edit_note" title="No prompts yet">Create one with "New prompt" to start versioning what your agent says.</EmptyState>
    <EmptyState v-else-if="filtered.length === 0" icon="search_off" title="No matches">Try a different search.</EmptyState>

    <div v-else class="mt-card table-card">
      <table class="prompts">
        <thead>
          <tr>
            <th>Prompt</th>
            <th class="num">Latest</th>
            <th>Tags</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id" class="prompt-row" :data-testid="`prompt-row-${p.name}`" tabindex="0" @click="open(p.id)" @keydown.enter="open(p.id)">
            <td>
              <span class="name">{{ p.name }}</span>
              <span v-if="p.archivedAt" class="mt-pill archived">archived</span>
              <div v-if="p.description" class="muted desc">{{ p.description }}</div>
            </td>
            <td class="num mono">v{{ p.latestVersion }}</td>
            <td>
              <span v-for="(version, tag) in p.tags" :key="tag" class="mt-pill tag" :data-testid="`tag-${p.name}-${tag}`">{{ tag }} → v{{ version }}</span>
              <span v-if="Object.keys(p.tags).length === 0" class="muted">no tags</span>
            </td>
            <td class="muted mono">{{ formatDateTime(p.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <Modal v-if="showCreate" title="New prompt" medium @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <TextInput v-model="form.name" placeholder="name, e.g. weather-system" mono autofocus :invalid="!!fieldErrors.name" data-testid="prompt-name" />
        <p v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</p>
        <TextInput v-model="form.description" placeholder="What is it for? (optional)" />
        <TextInput v-model="form.content" multiline :rows="10" mono placeholder="Prompt text. Use {{variable}} for the parts that change." :invalid="!!fieldErrors.content" data-testid="prompt-content" />
        <p v-if="fieldErrors.content" class="field-error">{{ fieldErrors.content }}</p>
        <TextInput v-model="form.message" placeholder="Message for version 1 (optional)" />
        <button type="submit" class="primary-btn" :disabled="creating || !form.name.trim() || !form.content.trim()" data-testid="create-prompt">Create</button>
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
  gap: 12px;
}
.search {
  width: 240px;
}
.archived-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--mt-muted);
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
.prompts {
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
  padding: 10px 14px;
  border-bottom: 1px solid var(--mt-line-2);
  vertical-align: middle;
}
.num {
  text-align: right;
}
.name {
  font-weight: 800;
}
.desc {
  margin-top: 2px;
  font-size: 12px;
}
.prompt-row {
  cursor: pointer;
}
.prompt-row:hover,
.prompt-row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.tag {
  margin-right: 6px;
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
}
.archived {
  margin-left: 8px;
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field-error {
  margin: -6px 0 0;
  font-size: 12px;
  color: var(--mt-err-ink);
}
.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
