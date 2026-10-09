<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import ErrorBanner from "./ErrorBanner.vue";
import Modal from "./Modal.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";

/**
 * Mete esta traza, o items de un run, en una cola de revisión existente (ADR-039). Las colas se crean en Review (solo admins).
 * Con un run se ofrece una muestra aleatoria (lo recomendable para medir el acuerdo del juez, ADR-040) o todos sus items.
 */
const props = defineProps<{ traceId?: string; run?: { datasetRunId: string; itemCount: number } }>();
/** Tope de una petición (ADR-039): un run mayor solo se puede enviar muestreado. */
const MAX_ALL = 500;
const emit = defineEmits<{ close: [] }>();

const api = useTraceApi();
const $q = useQuasar();
const queues = useAsync((signal) => api.listAnnotationQueues(false, signal));
void queues.run();

const selected = ref<string | null>(null);
const saving = ref(false);
const items = computed(() => queues.data.value?.items ?? []);
const canSendAll = computed(() => (props.run?.itemCount ?? 0) <= MAX_ALL);
const mode = ref<"sample" | "all">("sample");
const sampleSize = ref(Math.max(1, Math.min(50, props.run?.itemCount ?? 1)));
const subject = computed(() => (props.run ? "the items" : "the trace"));

async function add() {
  if (!selected.value) return;
  saving.value = true;
  try {
    const body = props.run
      ? { fromRun: { datasetRunId: props.run.datasetRunId, ...(mode.value === "sample" ? { sample: { size: sampleSize.value } } : {}) } }
      : { traceIds: [props.traceId!] };
    const result = await api.addAnnotationQueueItems(selected.value, body);
    const seed = result.sample ? ` · sample seed ${result.sample.seed}` : "";
    $q.notify({ message: result.added ? `Added ${result.added} to the queue${result.duplicates ? ` (${result.duplicates} already there)` : ""}${seed}` : "Already in that queue", color: result.added ? "positive" : "info", timeout: 4000 });
    emit("close");
  } catch (error) {
    $q.notify({ message: `Could not add ${subject.value}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="Add to review queue" @close="emit('close')">
    <ErrorBanner v-if="queues.error.value" :error="queues.error.value" @retry="queues.run()" />
    <p v-else-if="queues.data.value && !items.length" class="muted" data-testid="no-queues">There are no review queues yet. An experiment admin can create one in Review.</p>
    <form v-else class="form" @submit.prevent="add">
      <fieldset v-if="run" class="how" data-testid="run-selection">
        <label>
          <input v-model="mode" type="radio" name="mode" value="sample" />
          Random sample of
          <input v-model.number="sampleSize" class="size" type="number" min="1" :max="Math.min(run.itemCount, MAX_ALL)" aria-label="Sample size" :disabled="mode !== 'sample'" />
          of {{ run.itemCount }} items
        </label>
        <label :class="{ off: !canSendAll }">
          <input v-model="mode" type="radio" name="mode" value="all" :disabled="!canSendAll" />
          All {{ run.itemCount }} items{{ canSendAll ? "" : ` (more than ${MAX_ALL}: send a sample)` }}
        </label>
        <p class="muted">A random sample is what makes the judge-vs-human agreement representative; labeling only the items the judge failed would bias it.</p>
      </fieldset>
      <label v-for="q in items" :key="q.id" class="option">
        <input v-model="selected" type="radio" name="queue" :value="q.id" />
        <span class="name">{{ q.name }}</span>
        <span class="muted">{{ q.progress.pending }} pending</span>
      </label>
      <Button variant="primary" type="submit" :disabled="!selected || saving">Add</Button>
    </form>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  font-size: 13px;
  cursor: pointer;
}
.name {
  font-weight: 600;
}
.how {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 0 4px;
  padding: 8px 10px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  font-size: 13px;
}
.how .size {
  width: 64px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card, #fff);
  color: var(--mt-ink);
}
.how .off {
  color: var(--mt-muted);
}
.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 0;
}

</style>
