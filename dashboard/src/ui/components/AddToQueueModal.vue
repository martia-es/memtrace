<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import ErrorBanner from "./ErrorBanner.vue";
import Modal from "./Modal.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";
import Radio from "./Radio.vue";
import { t } from "../i18n";

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
    const seed = result.sample ? ` · ${t("addToQueueModal.sample_seed_seed", { seed: result.sample.seed })}` : "";
    $q.notify({ message: result.added ? `${t("addToQueueModal.added_count_to_the_queue", { count: result.added })}${result.duplicates ? ` (${t("addToQueueModal.count_already_there", { count: result.duplicates })})` : ""}${seed}` : t("addToQueueModal.already_in_that_queue"), color: result.added ? "positive" : "info", timeout: 4000 });
    emit("close");
  } catch (error) {
    $q.notify({ message: `${t("addToQueueModal.could_not_add_subject", { subject: subject.value })}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="t('addToQueueModal.add_to_review_queue')" @close="emit('close')">
    <ErrorBanner v-if="queues.error.value" :error="queues.error.value" @retry="queues.run()" />
    <p v-else-if="queues.data.value && !items.length" class="muted" data-testid="no-queues">{{ t("addToQueueModal.there_are_no_review_queues_yet") }}</p>
    <form v-else class="form" @submit.prevent="add">
      <fieldset v-if="run" class="how" data-testid="run-selection">
        <label>
          <Radio v-model="mode" name="mode" value="sample" />
          {{ t("addToQueueModal.random_sample_of") }}
          <input v-model.number="sampleSize" class="size" type="number" min="1" :max="Math.min(run.itemCount, MAX_ALL)" :aria-label="t('addToQueueModal.sample_size')" :disabled="mode !== 'sample'" />
          {{ t("addToQueueModal.of_count_items", { count: run.itemCount }) }}
        </label>
        <Radio :class="{ off: !canSendAll }" v-model="mode" name="mode" value="all" :disabled="!canSendAll"> {{ t("addToQueueModal.all_count_items", { count: run.itemCount }) }}{{ canSendAll ? "" : ` ${t("addToQueueModal.more_than_max_send_a_sample", { max: MAX_ALL })}` }}</Radio>
        <p class="muted">{{ t("addToQueueModal.a_random_sample_is_what_makes") }}</p>
      </fieldset>
      <Radio v-for="q in items" :key="q.id" class="option" v-model="selected" name="queue" :value="q.id"> <span class="name">{{ q.name }}</span>
        <span class="muted">{{ t('addToQueueModal.count_pending', { count: q.progress.pending }) }}</span></Radio>
      <Button variant="primary" type="submit" :disabled="!selected || saving">{{ t("addToQueueModal.add") }}</Button>
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
