<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "./Select.vue";
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import type { PromotionSkipReasonDto, SpanNodeDto } from "@contract";
import { fixtureDraftOf, parseFixtureText } from "@/domain/promote";
import ErrorBanner from "./ErrorBanner.vue";
import Modal from "./Modal.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";
import FormField from "./FormField.vue";
import { lazyMessages } from "@/domain/translate";
import { t } from "../i18n";

/**
 * Promueve esta traza a un item de dataset (ADR-038). El item es una COPIA: la persona ve y puede corregir la entrada
 * (p. ej. tachar datos personales) y escribe la respuesta correcta; lo que dijo el agente queda solo como contexto.
 */
const props = defineProps<{ traceId: string; roots: SpanNodeDto[] }>();
const emit = defineEmits<{ close: [] }>();

const REASONS: Record<PromotionSkipReasonDto, string> = lazyMessages({
  already_promoted: "addToDatasetModal.this_trace_is_already_in_that",
  no_content: "addToDatasetModal.this_trace_has_no_input_saved",
  not_found: "addToDatasetModal.trace_not_found",
  ambiguous_label: "addToDatasetModal.the_annotators_disagree",
  unsupported_label: "addToDatasetModal.that_label_is_not_a_reference",
});

const api = useTraceApi();
const $q = useQuasar();
const datasets = useAsync((signal) => api.listDatasets(signal));
void datasets.run();

const draft = fixtureDraftOf(props.roots);
const datasetId = ref<string | null>(null);
const input = ref(draft?.input ?? "");
const expected = ref("");
const saving = ref(false);
const items = computed(() => datasets.data.value?.items ?? []);
const datasetOptions = computed(() => items.value.map((d) => ({ label: d.name, value: d.id })));
const canSave = computed(() => !!datasetId.value && input.value.trim() !== "" && !saving.value);

async function save() {
  if (!datasetId.value) return;
  saving.value = true;
  try {
    const result = await api.promoteTracesToDataset(datasetId.value, {
      items: [{ traceId: props.traceId, input: parseFixtureText(input.value), ...(expected.value.trim() ? { expectedOutput: parseFixtureText(expected.value) } : {}) }],
    });
    const skipped = result.skipped[0];
    if (skipped) {
      $q.notify({ message: REASONS[skipped.reason], color: "warning", timeout: 5000 });
      return;
    }
    const v = result.version;
    $q.notify({ message: `${t("addToDatasetModal.added_to_the_dataset")}${v ? ` · ${t("addToDatasetModal.new_version_version", { version: `${v.major}.${v.minor}` })}` : ""}`, color: "positive", timeout: 4000 });
    emit("close");
  } catch (error) {
    $q.notify({ message: `${t("addToDatasetModal.could_not_add_the_trace")}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="t('addToDatasetModal.add_to_dataset')" wide @close="emit('close')">
    <ErrorBanner v-if="datasets.error.value" :error="datasets.error.value" @retry="datasets.run()" />
    <p v-else-if="datasets.data.value && !items.length" class="muted" data-testid="no-datasets">{{ t("addToDatasetModal.there_are_no_datasets_yet_create") }}</p>
    <form v-else class="form" @submit.prevent="save">
      <FormField :label="t('addToDatasetModal.dataset')">
        <Select v-model="datasetId" :options="datasetOptions" :placeholder="t('addToDatasetModal.choose_a_dataset')" data-testid="dataset-select" />
      </FormField>
      <FormField :label="t('addToDatasetModal.input')">
        <TextInput v-model="input" multiline mono :rows="5" data-testid="input" spellcheck="false" />
        <small v-if="!draft" class="warn" data-testid="no-content">{{ t("addToDatasetModal.no_input_was_saved_in_this") }}</small>
        <small v-else class="muted">{{ t("addToDatasetModal.copied_from_the_trace_remove_personal") }}</small>
      </FormField>
      <FormField :label="t('addToDatasetModal.expected_output')">
        <TextInput v-model="expected" multiline mono :rows="3" data-testid="expected" spellcheck="false" :placeholder="t('addToDatasetModal.the_correct_answer_optional')" />
        <small v-if="!expected.trim()" class="muted" data-testid="no-expected">{{ t("addToDatasetModal.without_it_only_evaluators_that_need") }}</small>
      </FormField>
      <p v-if="draft?.observedOutput" class="observed muted">
        <strong>{{ t("addToDatasetModal.the_agent_answered") }}</strong> {{ draft.observedOutput }}<br />
        {{ t("addToDatasetModal.it_is_saved_as_context_in") }}
      </p>
      <Button variant="primary" type="submit" data-testid="save" :disabled="!canSave">{{ t("addToDatasetModal.add_to_dataset") }}</Button>
    </form>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field select,
.field textarea {
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card, #fff);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 400;
  padding: 8px 10px;
}
.field textarea {
  font-family: var(--mt-mono, monospace);
  font-size: 12.5px;
  resize: vertical;
}
.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  font-weight: 400;
  margin: 0;
}
.warn {
  color: var(--mt-danger, #b42318);
  font-weight: 400;
}
.observed {
  padding: 8px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  white-space: pre-wrap;
}

</style>
