<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ScoreConfigDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { parseCategories, parseTargetPercent } from "../score-config-form";
import Modal from "./Modal.vue";
import Select from "./Select.vue";
import Button from "./Button.vue";
import { t } from "../i18n";

/** Formulario de nueva score config (ADR-036), compartido por Admin → Score configs y el panel de anotación (ADR-037). */
const props = defineProps<{ experimentId: string }>();
const emit = defineEmits<{ close: []; created: [config: ScoreConfigDto] }>();

const api = useIdentityApi();
const $q = useQuasar();

const TYPE_OPTIONS = [
  { label: t("newScoreConfigModal.numeric_range"), value: "numeric" as const },
  { label: t("newScoreConfigModal.boolean_yes_no"), value: "boolean" as const },
  { label: t("newScoreConfigModal.categorical_labels"), value: "categorical" as const },
];

const saving = ref(false);
const form = reactive({ name: "", dataType: "numeric" as ScoreConfigDto["dataType"], min: "1", max: "5", categories: "", target: "", description: "" });

const canCreate = computed(() => {
  if (!form.name.trim()) return false;
  if (form.dataType === "numeric") return form.min.trim() !== "" && form.max.trim() !== "" && Number(form.min) < Number(form.max);
  if (form.dataType === "categorical") return parseCategories(form.categories).length >= 2;
  if (form.dataType === "boolean") return !Number.isNaN(parseTargetPercent(form.target));
  return true;
});

async function create() {
  saving.value = true;
  try {
    const config = await api.createScoreConfig(props.experimentId, {
      name: form.name.trim(),
      dataType: form.dataType,
      minValue: form.dataType === "numeric" ? Number(form.min) : null,
      maxValue: form.dataType === "numeric" ? Number(form.max) : null,
      categories: form.dataType === "categorical" ? parseCategories(form.categories) : null,
      targetPassRate: form.dataType === "boolean" ? parseTargetPercent(form.target) : null,
      description: form.description.trim() || null,
    });
    emit("created", config);
    emit("close");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    $q.notify({ message: t("newScoreConfigModal.could_not_create_score_config_detail", { detail }), color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="t('newScoreConfigModal.new_score_config')" @close="emit('close')">
    <form class="modal-form" @submit.prevent="create">
      <TextInput v-model="form.name" :placeholder="t('newScoreConfigModal.name_e_g_tone')" autofocus />
      <Select v-model="form.dataType" :options="TYPE_OPTIONS" />
      <div v-if="form.dataType === 'numeric'" class="range-row">
        <TextInput v-model="form.min" type="number" step="any" :placeholder="t('newScoreConfigModal.min')" />
        <TextInput v-model="form.max" type="number" step="any" :placeholder="t('newScoreConfigModal.max')" />
      </div>
      <template v-if="form.dataType === 'boolean'">
        <TextInput v-model="form.target" type="number" step="any" min="1" max="100" :placeholder="t('newScoreConfigModal.target_pass_rate_in_optional_default')" />
        <p class="hint">{{ t("newScoreConfigModal.evaluators_with_this_name_are_judged") }}</p>
      </template>
      <template v-if="form.dataType === 'categorical'">
        <TextInput multiline v-model="form.categories" :rows="4" :placeholder="t('newScoreConfigModal.one_category_per_line_at_least')" />
        <p class="hint">{{ t("newScoreConfigModal.optional") + " " }}<code>{{ t("newScoreConfigModal.number") }}</code>{{ " " + t("newScoreConfigModal.after_a_label_gives_it_a") }}</p>
      </template>
      <TextInput multiline v-model="form.description" :rows="2" :placeholder="t('newScoreConfigModal.guideline_shown_to_the_annotator_optiona')" />
      <Button class="self-start" variant="primary" type="submit" :disabled="saving || !canCreate">{{ t("newScoreConfigModal.create") }}</Button>
    </form>
  </Modal>
</template>

<style scoped>
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
