<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ScoreConfigDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { formatCategories, describeScale, parseCategories } from "../score-config-form";
import Modal from "./Modal.vue";
import Select from "./Select.vue";

/**
 * Rúbricas de anotación de un experimento (ADR-036). Cualquier miembro las ve; solo un admin puede
 * crearlas, ampliarlas o archivarlas (la API devuelve 403 si no, `canManage` solo oculta los botones).
 */
const props = defineProps<{ experimentId: string; canManage: boolean }>();

const api = useIdentityApi();
const $q = useQuasar();

const configs = ref<ScoreConfigDto[]>([]);
const loading = ref(true);
const showArchived = ref(false);

async function load() {
  loading.value = true;
  try {
    configs.value = await api.listScoreConfigs(props.experimentId, showArchived.value);
  } catch (error) {
    notifyError("Could not load score configs", error);
  } finally {
    loading.value = false;
  }
}
void load();

function notifyError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  $q.notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
}

function toggleArchived() {
  showArchived.value = !showArchived.value;
  void load();
}

const TYPE_OPTIONS = [
  { label: "Numeric (range)", value: "numeric" as const },
  { label: "Boolean (yes / no)", value: "boolean" as const },
  { label: "Categorical (labels)", value: "categorical" as const },
];
const TYPE_LABEL: Record<ScoreConfigDto["dataType"], string> = { numeric: "numeric", boolean: "boolean", categorical: "categorical" };

// ---- create ----
const showCreate = ref(false);
const saving = ref(false);
const form = reactive({ name: "", dataType: "numeric" as ScoreConfigDto["dataType"], min: "1", max: "5", categories: "", description: "" });

function openCreate() {
  Object.assign(form, { name: "", dataType: "numeric", min: "1", max: "5", categories: "", description: "" });
  showCreate.value = true;
}

const canCreate = computed(() => {
  if (!form.name.trim()) return false;
  if (form.dataType === "numeric") return form.min.trim() !== "" && form.max.trim() !== "" && Number(form.min) < Number(form.max);
  if (form.dataType === "categorical") return parseCategories(form.categories).length >= 2;
  return true;
});

async function create() {
  saving.value = true;
  try {
    await api.createScoreConfig(props.experimentId, {
      name: form.name.trim(),
      dataType: form.dataType,
      minValue: form.dataType === "numeric" ? Number(form.min) : null,
      maxValue: form.dataType === "numeric" ? Number(form.max) : null,
      categories: form.dataType === "categorical" ? parseCategories(form.categories) : null,
      description: form.description.trim() || null,
    });
    showCreate.value = false;
    await load();
  } catch (error) {
    notifyError("Could not create score config", error);
  } finally {
    saving.value = false;
  }
}

// ---- edit: only what the invariants allow (description, widen range, add categories) ----
const editing = ref<ScoreConfigDto | null>(null);
const edit = reactive({ description: "", min: "", max: "", categories: "" });

function openEdit(config: ScoreConfigDto) {
  editing.value = config;
  Object.assign(edit, {
    description: config.description ?? "",
    min: config.minValue === null ? "" : String(config.minValue),
    max: config.maxValue === null ? "" : String(config.maxValue),
    categories: formatCategories(config.categories),
  });
}

async function saveEdit() {
  const config = editing.value;
  if (!config) return;
  saving.value = true;
  try {
    await api.updateScoreConfig(props.experimentId, config.id, {
      description: edit.description.trim() || null,
      ...(config.dataType === "numeric" ? { minValue: Number(edit.min), maxValue: Number(edit.max) } : {}),
      ...(config.dataType === "categorical" ? { categories: parseCategories(edit.categories) } : {}),
    });
    editing.value = null;
    await load();
  } catch (error) {
    notifyError("Could not update score config", error);
  } finally {
    saving.value = false;
  }
}

async function setArchived(config: ScoreConfigDto, archived: boolean) {
  try {
    if (archived) await api.archiveScoreConfig(props.experimentId, config.id);
    else await api.unarchiveScoreConfig(props.experimentId, config.id);
    await load();
  } catch (error) {
    notifyError(archived ? "Could not archive" : "Could not unarchive", error);
  }
}
</script>

<template>
  <div class="score-configs">
    <p class="hint">
      Rubrics declare what can be scored and how, so labels from different people are comparable. The type can't change
      after creation; ranges can only widen and categories can only be added.
    </p>

    <ul v-if="configs.length" class="config-list">
      <li v-for="c in configs" :key="c.id" class="config-row" :class="{ archived: c.archivedAt }" data-testid="score-config-row">
        <div class="config-info">
          <span class="config-name">{{ c.name }}</span>
          <span class="config-scale">{{ describeScale(c) }}</span>
          <span v-if="c.description" class="config-desc">{{ c.description }}</span>
        </div>
        <span class="type-pill">{{ TYPE_LABEL[c.dataType] }}</span>
        <span v-if="c.archivedAt" class="type-pill archived-pill">archived</span>
        <template v-if="canManage">
          <button v-if="!c.archivedAt" class="small-btn" type="button" @click="openEdit(c)">Edit</button>
          <button v-if="!c.archivedAt" class="small-btn danger" type="button" @click="setArchived(c, true)">Archive</button>
          <button v-else class="small-btn" type="button" @click="setArchived(c, false)">Unarchive</button>
        </template>
      </li>
    </ul>
    <p v-else-if="!loading" class="hint">
      No score configs yet.<template v-if="!canManage"> An experiment admin needs to create them before anyone can annotate.</template>
    </p>

    <div class="config-actions">
      <button v-if="canManage" class="primary-btn" type="button" @click="openCreate">New score config</button>
      <button class="link-btn" type="button" @click="toggleArchived">{{ showArchived ? "Hide archived" : "Show archived" }}</button>
    </div>

    <Modal v-if="showCreate" title="New score config" @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <input v-model="form.name" class="text-input" placeholder="Name (e.g. tone)" autofocus />
        <Select v-model="form.dataType" :options="TYPE_OPTIONS" />
        <div v-if="form.dataType === 'numeric'" class="range-row">
          <input v-model="form.min" class="text-input" type="number" step="any" placeholder="Min" />
          <input v-model="form.max" class="text-input" type="number" step="any" placeholder="Max" />
        </div>
        <template v-if="form.dataType === 'categorical'">
          <textarea v-model="form.categories" class="text-input area" rows="4" placeholder="One category per line (at least 2)&#10;bad=0&#10;ok=1&#10;good=2" />
          <p class="hint">Optional <code>=number</code> after a label gives it a value, used for correlation with judge scores.</p>
        </template>
        <textarea v-model="form.description" class="text-input area" rows="2" placeholder="Guideline shown to the annotator (optional)" />
        <button type="submit" class="primary-btn" :disabled="saving || !canCreate">Create</button>
      </form>
    </Modal>

    <Modal v-if="editing" :title="`Edit ${editing.name}`" @close="editing = null">
      <form class="modal-form" @submit.prevent="saveEdit">
        <div v-if="editing.dataType === 'numeric'" class="range-row">
          <input v-model="edit.min" class="text-input" type="number" step="any" :max="editing.minValue ?? undefined" aria-label="Min (can only be lowered)" />
          <input v-model="edit.max" class="text-input" type="number" step="any" :min="editing.maxValue ?? undefined" aria-label="Max (can only be raised)" />
        </div>
        <template v-if="editing.dataType === 'categorical'">
          <textarea v-model="edit.categories" class="text-input area" rows="5" />
          <p class="hint">Add lines to add categories. Existing ones can't be removed, renamed or re-valued.</p>
        </template>
        <textarea v-model="edit.description" class="text-input area" rows="2" placeholder="Guideline shown to the annotator (optional)" />
        <button type="submit" class="primary-btn" :disabled="saving">Save</button>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.score-configs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hint {
  color: var(--mt-muted);
  font-size: 13px;
  margin: 0;
}
.hint code {
  font-family: var(--mt-mono);
  background: var(--mt-soft);
  padding: 1px 5px;
  border-radius: var(--mt-radius-sm);
  font-size: 12px;
}
.config-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
}
.config-row.archived {
  opacity: 0.6;
}
.config-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.config-name {
  font-weight: 600;
  font-size: 13px;
}
.config-scale,
.config-desc {
  color: var(--mt-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type-pill {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
}
.archived-pill {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.small-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: transparent;
  color: var(--mt-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.small-btn:hover {
  color: var(--mt-ink);
  border-color: var(--mt-accent);
}
.small-btn.danger {
  border-color: var(--mt-err-ink);
  color: var(--mt-err-ink);
}
.config-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.range-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  height: 40px;
  padding: 0 14px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
}
.text-input.area {
  height: auto;
  padding: 10px 14px;
  resize: vertical;
}
.text-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
}
.primary-btn {
  align-self: flex-start;
  height: 34px;
  padding: 0 16px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
