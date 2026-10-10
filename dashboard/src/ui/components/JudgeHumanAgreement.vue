<script setup lang="ts">
import type { JudgeHumanMetricDto } from "@contract";
import { computed } from "vue";
import type { AgreementScope } from "@/application/trace-api";
import { describePopulation, formatKappa, formatRate, itemIndexOfTarget, kappaLabel, kappaNote, kappaTone, lowSampleNote } from "@/domain/agreement";
import ErrorBanner from "./ErrorBanner.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";
import LoadingState from "./LoadingState.vue";
import Card from "./Card.vue";

/**
 * "Agreement with human labels" (ADR-040): por evaluador, cuánto coinciden el juez LLM y las personas. La parte que
 * más vale es la lista de desacuerdos: dónde difieren, para corregir el prompt del juez.
 */
const props = defineProps<{ scope: AgreementScope }>();
const emit = defineEmits<{ "select-item": [itemIndex: number] }>();

const api = useTraceApi();
const agreement = useAsync((signal) => api.getJudgeHumanAgreement(props.scope, undefined, signal));
void agreement.run();

const runId = computed(() => ("datasetRunId" in props.scope ? props.scope.datasetRunId : null));
const metrics = computed(() => agreement.data.value?.metrics ?? []);
const unmatched = computed(() => agreement.data.value?.unmatched ?? { judgeOnly: [], humanOnly: [] });
const population = computed(() => {
  const counts = agreement.data.value?.scope.population;
  return counts ? describePopulation(counts) : null;
});
const traceTargets = computed(() => agreement.data.value?.scope.traceTargets ?? 0);

const judgeLabel = (m: JudgeHumanMetricDto) => (m.judge ? `${m.judge.model ?? "unknown model"}${m.judge.promptHash ? ` · rubric ${m.judge.promptHash}` : ""}` : m.judges.length > 1 ? `${m.judges.length} judges` : "unknown judge");

function excludedText(m: JudgeHumanMetricDto): string | null {
  const parts = [
    m.excluded.noHuman ? `${m.excluded.noHuman} without a human label` : null,
    m.excluded.noJudge ? `${m.excluded.noJudge} without a judge score` : null,
    m.excluded.ties ? `${m.excluded.ties} with tied human votes` : null,
    m.excluded.invalid ? `${m.excluded.invalid} with an invalid value` : null,
  ].filter(Boolean);
  return parts.length ? `Left out: ${parts.join(", ")}.` : null;
}

function targetLabel(target: string): string {
  const index = runId.value ? itemIndexOfTarget(target, runId.value) : null;
  return index !== null ? `Item ${index}` : target;
}
</script>

<template>
  <Card as="section" padding="none" block class="agreement" data-testid="judge-human-agreement">
    <header>
      <h2>Agreement with human labels</h2>
      <slot name="actions" />
    </header>

    <ErrorBanner v-if="agreement.error.value" :error="agreement.error.value" @retry="agreement.run()" />
    <LoadingState v-else-if="agreement.loading.value && !agreement.data.value" size="md" />

    <template v-else>
      <p v-if="!metrics.length" class="muted" data-testid="agreement-empty">
        No judge score has a human label yet. Send items to a review queue to collect them; the human rubric must use the same name as the evaluator.
      </p>

      <article v-for="m in metrics" :key="m.name" class="metric" data-testid="agreement-metric">
        <div class="title">
          <strong>{{ m.name }}</strong>
          <span class="muted">{{ m.dataType }} · judge: {{ judgeLabel(m) }}</span>
        </div>

        <p v-if="m.status !== 'ok'" class="notice" data-testid="agreement-status">
          {{ m.status === "mixed_judges" ? "Scores of this evaluator come from different judge versions, so no single number is shown." : "Judge and human labels use different types, so they cannot be compared." }}
          <span class="muted">{{ m.reason }}</span>
        </p>

        <template v-else>
          <p v-if="m.lowSample" class="notice" data-testid="agreement-low-sample">{{ lowSampleNote(m.n) }}</p>

          <div class="stats">
            <div v-if="m.dataType !== 'numeric'" class="stat" :class="kappaTone(m.kappa)">
              <span class="value" data-testid="agreement-kappa">{{ formatKappa(m.kappa) }}</span>
              <span class="label">Cohen's kappa · {{ kappaLabel(m.kappa) }}</span>
            </div>
            <div class="stat">
              <span class="value">{{ formatRate(m.percentAgreement) }}</span>
              <span class="label">exact agreement</span>
            </div>
            <template v-if="m.dataType === 'numeric'">
              <div class="stat"><span class="value">{{ m.mae === null || m.mae === undefined ? "–" : m.mae.toFixed(2) }}</span><span class="label">mean abs. error</span></div>
              <div class="stat"><span class="value">{{ formatKappa(m.spearman) }}</span><span class="label">Spearman ρ</span></div>
              <div class="stat"><span class="value">{{ formatKappa(m.pearson) }}</span><span class="label">Pearson r</span></div>
              <div class="stat"><span class="value">{{ formatRate(m.withinOne) }}</span><span class="label">within ±1</span></div>
            </template>
            <div class="stat"><span class="value">{{ m.n }}</span><span class="label">items compared</span></div>
          </div>
          <p v-if="kappaNote(m)" class="muted">{{ kappaNote(m) }}</p>
          <p v-if="excludedText(m)" class="muted">{{ excludedText(m) }}</p>

          <table v-if="m.confusion" class="confusion" data-testid="agreement-confusion">
            <caption>Rows: human label · columns: judge</caption>
            <thead>
              <tr><th /><th v-for="label in m.confusion.labels" :key="label">{{ label }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="(row, h) in m.confusion.matrix" :key="m.confusion.labels[h]">
                <th>{{ m.confusion.labels[h] }}</th>
                <td v-for="(count, j) in row" :key="j" :class="{ diagonal: h === j }">{{ count }}</td>
              </tr>
            </tbody>
          </table>

          <div v-if="m.disagreements.length" class="disagreements" data-testid="agreement-disagreements">
            <h3>Where they differ ({{ m.disagreements.length }}{{ m.disagreements.length >= 100 ? "+" : "" }})</h3>
            <ul>
              <li v-for="d in m.disagreements.slice(0, 20)" :key="d.target">
                <Button variant="link" v-if="runId && itemIndexOfTarget(d.target, runId) !== null" @click="emit('select-item', itemIndexOfTarget(d.target, runId)!)">{{ targetLabel(d.target) }}</Button>
                <span v-else class="mono">{{ targetLabel(d.target) }}</span>
                <span class="muted">judge <strong>{{ d.judge }}</strong> · human <strong>{{ d.human }}</strong></span>
              </li>
            </ul>
          </div>
        </template>
      </article>

      <p v-if="traceTargets" class="muted" data-testid="agreement-trace-targets">
        {{ traceTargets }} trace{{ traceTargets === 1 ? "" : "s" }} in this queue {{ traceTargets === 1 ? "is" : "are" }} not compared: only run items have judge scores.
      </p>
      <p v-if="unmatched.judgeOnly.length || unmatched.humanOnly.length" class="muted" data-testid="agreement-unmatched">
        Not compared because the names don't match:
        <template v-if="unmatched.judgeOnly.length">evaluators without a human rubric ({{ unmatched.judgeOnly.join(", ") }})</template>
        <template v-if="unmatched.judgeOnly.length && unmatched.humanOnly.length">; </template>
        <template v-if="unmatched.humanOnly.length">human rubrics without an evaluator ({{ unmatched.humanOnly.join(", ") }})</template>.
      </p>
      <p v-if="metrics.length && population" class="muted" :class="{ warn: population.tone === 'warn' }" data-testid="agreement-population">{{ population.text }}</p>
      <p v-if="metrics.length && !population" class="muted">
        Agreement is only as representative as the sample: label a random sample of items, not only the ones the judge failed.
      </p>
    </template>
  </Card>
</template>

<style scoped>
.agreement {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
h3 {
  margin: 8px 0 4px;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.muted {
  margin: 0;
  color: var(--mt-muted);
  font-size: 12.5px;
}
.muted.warn {
  color: var(--mt-warn-ink, var(--mt-muted));
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
}
.title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}
.notice {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-warn-bg, rgba(245, 158, 11, 0.12));
  color: var(--mt-warn-ink, inherit);
  font-size: 12.5px;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stat {
  display: flex;
  flex-direction: column;
  min-width: 96px;
  padding: 8px 12px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card, #fff);
}
.stat .value {
  font-size: 20px;
  font-weight: 700;
}
.stat .label {
  color: var(--mt-muted);
  font-size: 11.5px;
}
.stat.positive .value {
  color: var(--mt-ok-ink, inherit);
}
.stat.warning .value {
  color: var(--mt-warn-ink, inherit);
}
.stat.negative .value {
  color: var(--mt-err-ink, inherit);
}
.confusion {
  border-collapse: collapse;
  font-size: 12.5px;
  width: max-content;
}
.confusion caption {
  caption-side: top;
  text-align: left;
  padding-bottom: 4px;
  color: var(--mt-muted);
  font-size: 11.5px;
}
.confusion th,
.confusion td {
  padding: 4px 12px;
  border: 1px solid var(--mt-line);
  text-align: center;
}
.confusion td.diagonal {
  font-weight: 700;
  background: var(--mt-card, #fff);
}
.disagreements ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow: auto;
}
.disagreements li {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12.5px;
}
.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--mt-accent-ink, var(--mt-accent));
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}
</style>
