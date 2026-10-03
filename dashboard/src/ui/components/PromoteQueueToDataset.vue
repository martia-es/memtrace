<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import type { PromotionSkipReasonDto, QueueItemDto, ScoreConfigDto } from "@contract";
import { countSkipReasons, promotableTraceIds, promotionBatches, PROMOTE_BATCH_SIZE } from "@/domain/queue-promotion";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

/**
 * Promueve a un dataset las trazas ya revisadas de la cola (ADR-038, ampliado por ADR-045). Cada tanda de 100 es UNA
 * versión major; la respuesta correcta sale de una score config categórica de la rúbrica (opcional) y, si no hay,
 * el item queda sin referencia. Las trazas ya promovidas se omiten sin error.
 */
const props = defineProps<{ items: QueueItemDto[]; configs: ScoreConfigDto[] }>();

const REASONS: Record<PromotionSkipReasonDto, string> = {
  already_promoted: "already in the dataset",
  no_content: "no input saved",
  not_found: "not found",
  ambiguous_label: "reviewers disagree",
  unsupported_label: "label is not a reference answer",
};

const api = useTraceApi();
const $q = useQuasar();
const datasets = useAsync((signal) => api.listDatasets(signal));
void datasets.run();

const datasetId = ref<string | null>(null);
const configId = ref<string>("");
const saving = ref(false);
const traceIds = computed(() => promotableTraceIds(props.items));
const categorical = computed(() => props.configs.filter((c) => c.dataType === "categorical" && !c.archivedAt));
const batches = computed(() => Math.ceil(traceIds.value.length / PROMOTE_BATCH_SIZE));
const canPromote = computed(() => !!datasetId.value && traceIds.value.length > 0 && !saving.value);

async function promote() {
  if (!datasetId.value) return;
  saving.value = true;
  let added = 0;
  const skipped: Array<{ reason: PromotionSkipReasonDto }> = [];
  try {
    for (const body of promotionBatches(traceIds.value, configId.value || undefined)) {
      const result = await api.promoteTracesToDataset(datasetId.value, body);
      added += result.added.length;
      skipped.push(...result.skipped);
    }
    const counts = countSkipReasons(skipped);
    const detail = Object.entries(counts).map(([reason, n]) => `${n} ${REASONS[reason as PromotionSkipReasonDto]}`).join(", ");
    $q.notify({ message: `Promoted ${added} item${added === 1 ? "" : "s"}${detail ? ` · skipped: ${detail}` : ""}`, color: added ? "positive" : "warning", timeout: 6000 });
  } catch (error) {
    $q.notify({ message: `Could not promote: ${error instanceof Error ? error.message : String(error)}${added ? ` (${added} already added)` : ""}`, color: "negative", timeout: 6000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section data-testid="promote-queue">
    <h3>Promote to dataset</h3>
    <p v-if="!traceIds.length" class="muted" data-testid="promote-empty">No completed trace items yet: reviewed traces can be promoted to a dataset here.</p>
    <template v-else>
      <p class="muted">
        {{ traceIds.length }} reviewed trace{{ traceIds.length === 1 ? "" : "s" }} → {{ batches }} new dataset version{{ batches === 1 ? "" : "s" }}.
        Items are copies; without a reference label they have no expected output.
      </p>
      <div class="row">
        <select v-model="datasetId" aria-label="Dataset" data-testid="promote-dataset">
          <option :value="null" disabled>Choose a dataset…</option>
          <option v-for="d in datasets.data.value?.items ?? []" :key="d.id" :value="d.id">{{ d.name }}</option>
        </select>
        <select v-model="configId" aria-label="Expected output from" data-testid="promote-config">
          <option value="">No expected output</option>
          <option v-for="c in categorical" :key="c.id" :value="c.id">Expected output from “{{ c.name }}”</option>
        </select>
        <button type="button" class="small-btn" data-testid="promote-run" :disabled="!canPromote" @click="promote">Promote</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
h3 {
  margin: 0 0 6px;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 4px 0 0;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
select {
  height: 28px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12.5px;
}
.small-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.small-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
