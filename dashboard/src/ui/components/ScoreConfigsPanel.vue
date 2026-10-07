<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ScoreConfigDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { formatCategories, formatTargetPercent, describeScale, parseCategories, parseTargetPercent } from "../score-config-form";
import Modal from "./Modal.vue";
import NewScoreConfigModal from "./NewScoreConfigModal.vue";

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

const TYPE_LABEL: Record<ScoreConfigDto["dataType"], string> = { numeric: "numeric", boolean: "boolean", categorical: "categorical" };

const showCreate = ref(false);
const saving = ref(false);

// ---- edit: only what the invariants allow (description, widen range, add categories) ----
const editing = ref<ScoreConfigDto | null>(null);
const edit = reactive({ description: "", min: "", max: "", categories: "", target: "" });

function openEdit(config: ScoreConfigDto) {
  editing.value = config;
  Object.assign(edit, {
    description: config.description ?? "",
    min: config.minValue === null ? "" : String(config.minValue),
    max: config.maxValue === null ? "" : String(config.maxValue),
    categories: formatCategories(config.categories),
    target: formatTargetPercent(config.targetPassRate),
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
      ...(config.dataType === "boolean" ? { targetPassRate: parseTargetPercent(edit.target) } : {}),
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
          <span class="config-scale">{{ describeScale(c) }}<template v-if="c.targetPassRate !== null"> · target {{ formatTargetPercent(c.targetPassRate) }}%</template></span>
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
      No score configs yet.<template v-if="!canManage"> A technical profile needs to create them before anyone can annotate.</template>
    </p>

    <div class="config-actions">
      <button v-if="canManage" class="primary-btn mt-new" type="button" @click="showCreate = true">+ New score config</button>
      <button class="link-btn" type="button" @click="toggleArchived">{{ showArchived ? "Hide archived" : "Show archived" }}</button>
    </div>

    <NewScoreConfigModal v-if="showCreate" :experiment-id="experimentId" @close="showCreate = false" @created="load" />

    <Modal v-if="editing" :title="`Edit ${editing.name}`" @close="editing = null">
      <form class="modal-form" @submit.prevent="saveEdit">
        <div v-if="editing.dataType === 'numeric'" class="range-row">
          <TextInput v-model="edit.min" type="number" step="any" :max="editing.minValue ?? undefined" aria-label="Min (can only be lowered)" />
          <TextInput v-model="edit.max" type="number" step="any" :min="editing.maxValue ?? undefined" aria-label="Max (can only be raised)" />
        </div>
        <template v-if="editing.dataType === 'boolean'">
          <TextInput v-model="edit.target" type="number" step="any" min="1" max="100" placeholder="Target pass rate in % (empty = default 80)" aria-label="Target pass rate (%)" />
        </template>
        <template v-if="editing.dataType === 'categorical'">
          <TextInput multiline v-model="edit.categories" :rows="5" />
          <p class="hint">Add lines to add categories. Existing ones can't be removed, renamed or re-valued.</p>
        </template>
        <TextInput multiline v-model="edit.description" :rows="2" placeholder="Guideline shown to the annotator (optional)" />
        <button type="submit" class="primary-btn" :disabled="saving || (editing.dataType === 'boolean' && Number.isNaN(parseTargetPercent(edit.target)))">Save</button>
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
