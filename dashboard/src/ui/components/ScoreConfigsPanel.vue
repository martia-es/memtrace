<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ScoreConfigDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { formatCategories, formatTargetPercent, describeScale, parseCategories, parseTargetPercent } from "../score-config-form";
import Modal from "./Modal.vue";
import NewScoreConfigModal from "./NewScoreConfigModal.vue";
import Button from "./Button.vue";
import { t } from "../i18n";

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
    notifyError(t("scoreConfigsPanel.could_not_load_score_configs"), error);
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
    notifyError(t("scoreConfigsPanel.could_not_update_score_config"), error);
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
    notifyError(archived ? t("scoreConfigsPanel.could_not_archive") : t("scoreConfigsPanel.could_not_unarchive"), error);
  }
}
</script>

<template>
  <div class="score-configs">
    <p class="hint">
      {{ t("scoreConfigsPanel.rubrics_declare_what_can_be_scored") }}
    </p>

    <ul v-if="configs.length" class="config-list">
      <li v-for="c in configs" :key="c.id" class="config-row" :class="{ archived: c.archivedAt }" data-testid="score-config-row">
        <div class="config-info">
          <span class="config-name">{{ c.name }}</span>
          <span class="config-scale">{{ describeScale(c) }}<template v-if="c.targetPassRate !== null"> · {{ t('scoreConfigsPanel.target_percent', { percent: formatTargetPercent(c.targetPassRate) }) }}</template></span>
          <span v-if="c.description" class="config-desc">{{ c.description }}</span>
        </div>
        <span class="type-pill">{{ TYPE_LABEL[c.dataType] }}</span>
        <span v-if="c.archivedAt" class="type-pill archived-pill">{{ t("scoreConfigsPanel.archived") }}</span>
        <template v-if="canManage">
          <Button size="sm" v-if="!c.archivedAt" @click="openEdit(c)">{{ t("scoreConfigsPanel.edit") }}</Button>
          <Button variant="danger" size="sm" v-if="!c.archivedAt" @click="setArchived(c, true)">{{ t("scoreConfigsPanel.archive") }}</Button>
          <Button size="sm" v-else @click="setArchived(c, false)">{{ t("scoreConfigsPanel.unarchive") }}</Button>
        </template>
      </li>
    </ul>
    <p v-else-if="!loading" class="hint">
      {{ t("scoreConfigsPanel.no_score_configs_yet") }}<template v-if="!canManage">{{ " " + t("scoreConfigsPanel.a_technical_profile_needs_to_create") }}</template>
    </p>

    <div class="config-actions">
      <Button variant="primary" v-if="canManage" @click="showCreate = true" class="mt-new">{{ t("scoreConfigsPanel.new_score_config") }}</Button>
      <Button variant="link" @click="toggleArchived">{{ showArchived ? t("scoreConfigsPanel.hide_archived") : t("scoreConfigsPanel.show_archived") }}</Button>
    </div>

    <NewScoreConfigModal v-if="showCreate" :experiment-id="experimentId" @close="showCreate = false" @created="load" />

    <Modal v-if="editing" :title="t('scoreConfigsPanel.edit_name', { name: editing.name })" @close="editing = null">
      <form class="modal-form" @submit.prevent="saveEdit">
        <div v-if="editing.dataType === 'numeric'" class="range-row">
          <TextInput v-model="edit.min" type="number" step="any" :max="editing.minValue ?? undefined" :aria-label="t('scoreConfigsPanel.min_can_only_be_lowered')" />
          <TextInput v-model="edit.max" type="number" step="any" :min="editing.maxValue ?? undefined" :aria-label="t('scoreConfigsPanel.max_can_only_be_raised')" />
        </div>
        <template v-if="editing.dataType === 'boolean'">
          <TextInput v-model="edit.target" type="number" step="any" min="1" max="100" :placeholder="t('scoreConfigsPanel.target_pass_rate_in_empty_default')" :aria-label="t('scoreConfigsPanel.target_pass_rate')" />
        </template>
        <template v-if="editing.dataType === 'categorical'">
          <TextInput multiline v-model="edit.categories" :rows="5" />
          <p class="hint">{{ t("scoreConfigsPanel.add_lines_to_add_categories_existing") }}</p>
        </template>
        <TextInput multiline v-model="edit.description" :rows="2" :placeholder="t('scoreConfigsPanel.guideline_shown_to_the_annotator_optiona')" />
        <Button class="self-start" variant="primary" type="submit" :disabled="saving || (editing.dataType === 'boolean' && Number.isNaN(parseTargetPercent(edit.target)))">{{ t("scoreConfigsPanel.save") }}</Button>
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

.config-actions {
  display: flex;
  align-items: center;
  gap: 12px;
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

.self-start { align-self: flex-start; }
</style>
