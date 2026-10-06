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

/**
 * Promueve esta traza a un item de dataset (ADR-038). El item es una COPIA: la persona ve y puede corregir la entrada
 * (p. ej. tachar datos personales) y escribe la respuesta correcta; lo que dijo el agente queda solo como contexto.
 */
const props = defineProps<{ traceId: string; roots: SpanNodeDto[] }>();
const emit = defineEmits<{ close: [] }>();

const REASONS: Record<PromotionSkipReasonDto, string> = {
  already_promoted: "This trace is already in that dataset.",
  no_content: "This trace has no input saved. Type one below, or enable MEMTRACE_CAPTURE_CONTENT=true on the agent.",
  not_found: "Trace not found.",
  ambiguous_label: "The annotators disagree.",
  unsupported_label: "That label is not a reference answer.",
};

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
    $q.notify({ message: `Added to the dataset${v ? ` · new version ${v.major}.${v.minor}` : ""}`, color: "positive", timeout: 4000 });
    emit("close");
  } catch (error) {
    $q.notify({ message: `Could not add the trace: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="Add to dataset" wide @close="emit('close')">
    <ErrorBanner v-if="datasets.error.value" :error="datasets.error.value" @retry="datasets.run()" />
    <p v-else-if="datasets.data.value && !items.length" class="muted" data-testid="no-datasets">There are no datasets yet. Create one in Datasets.</p>
    <form v-else class="form" @submit.prevent="save">
      <label class="field">
        <span>Dataset</span>
        <Select v-model="datasetId" :options="datasetOptions" placeholder="Choose a dataset…" data-testid="dataset-select" />
      </label>
      <label class="field">
        <span>Input</span>
        <TextInput v-model="input" multiline mono :rows="5" data-testid="input" spellcheck="false" />
        <small v-if="!draft" class="warn" data-testid="no-content">No input was saved in this trace: type the input to use.</small>
        <small v-else class="muted">Copied from the trace. Remove personal data here: the item is a long-lived copy.</small>
      </label>
      <label class="field">
        <span>Expected output</span>
        <TextInput v-model="expected" multiline mono :rows="3" data-testid="expected" spellcheck="false" placeholder="The correct answer (optional)" />
        <small v-if="!expected.trim()" class="muted" data-testid="no-expected">Without it, only evaluators that need no reference (e.g. LLM-as-judge) can score this item.</small>
      </label>
      <p v-if="draft?.observedOutput" class="observed muted">
        <strong>The agent answered:</strong> {{ draft.observedOutput }}<br />
        It is saved as context in the item's metadata, not as the expected output.
      </p>
      <button type="submit" class="primary-btn" data-testid="save" :disabled="!canSave">Add to dataset</button>
    </form>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
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
.primary-btn {
  height: 36px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
