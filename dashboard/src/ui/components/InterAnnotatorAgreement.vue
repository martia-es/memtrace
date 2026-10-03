<script setup lang="ts">
import { computed } from "vue";
import { formatKappa, kappaLabel, kappaTone, lowSampleNote } from "@/domain/agreement";
import ErrorBanner from "./ErrorBanner.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

/** Cuánto coinciden entre sí las personas que etiquetan una cola (ADR-040): el techo de lo que puede esperarse de un juez. */
const props = defineProps<{ queueId: string }>();

const api = useTraceApi();
const agreement = useAsync((signal) => api.getInterAnnotatorAgreement(props.queueId, undefined, signal));
void agreement.run();
const metrics = computed(() => agreement.data.value?.metrics ?? []);

function value(m: (typeof metrics.value)[number]): number | null {
  return (m.dataType === "numeric" ? m.meanPairwiseSpearman : m.meanPairwiseKappa) ?? null;
}
</script>

<template>
  <div data-testid="inter-annotator-agreement">
    <ErrorBanner v-if="agreement.error.value" :error="agreement.error.value" @retry="agreement.run()" />
    <p v-else-if="agreement.data.value && !metrics.length" class="muted" data-testid="inter-annotator-empty">No labels yet.</p>
    <ul v-else class="plain">
      <li v-for="m in metrics" :key="`${m.name}-${m.dataType}`" data-testid="inter-annotator-row">
        <strong>{{ m.name }}</strong>
        <template v-if="m.pairs > 0">
          <span class="value" :class="kappaTone(value(m))">{{ formatKappa(value(m)) }}</span>
          <span class="muted">{{ m.dataType === "numeric" ? "mean Spearman ρ" : `mean Cohen's kappa · ${kappaLabel(value(m))}` }}</span>
        </template>
        <span v-else class="muted">needs at least two reviewers on the same items</span>
        <span class="muted">{{ m.annotators }} reviewer{{ m.annotators === 1 ? "" : "s" }} · {{ m.n }} shared item{{ m.n === 1 ? "" : "s" }}</span>
        <span v-if="m.pairs > 0 && m.lowSample" class="warn" :title="lowSampleNote(m.n)">low sample</span>
      </li>
    </ul>
    <p v-if="metrics.some((m) => m.pairs > 0)" class="muted hint">Low agreement between people usually means the rubric is ambiguous, not that the reviewers are wrong.</p>
  </div>
</template>

<style scoped>
.muted {
  margin: 0;
  color: var(--mt-muted);
  font-size: 12.5px;
}
.hint {
  margin-top: 6px;
}
.plain {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.plain li {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 6px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  font-size: 12.5px;
}
.value {
  font-size: 15px;
  font-weight: 700;
}
.value.positive {
  color: var(--mt-ok-ink, inherit);
}
.value.warning {
  color: var(--mt-warn-ink, inherit);
}
.value.negative {
  color: var(--mt-err-ink, inherit);
}
.warn {
  color: var(--mt-warn-ink, inherit);
  font-size: 11.5px;
  font-weight: 600;
}
</style>
