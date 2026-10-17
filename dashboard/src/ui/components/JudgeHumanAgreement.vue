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
import { t, tp } from "../i18n";

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

const judgeLabel = (m: JudgeHumanMetricDto) => (m.judge ? `${m.judge.model ?? t("judgeHumanAgreement.unknown_model")}${m.judge.promptHash ? ` · ${t("judgeHumanAgreement.rubric_hash", { hash: m.judge.promptHash })}` : ""}` : m.judges.length > 1 ? t("judgeHumanAgreement.count_judges", { count: m.judges.length }) : t("judgeHumanAgreement.unknown_judge"));

function excludedText(m: JudgeHumanMetricDto): string | null {
  const parts = [
    m.excluded.noHuman ? t("judgeHumanAgreement.count_without_a_human_label", { count: m.excluded.noHuman }) : null,
    m.excluded.noJudge ? t("judgeHumanAgreement.count_without_a_judge_score", { count: m.excluded.noJudge }) : null,
    m.excluded.ties ? t("judgeHumanAgreement.count_with_tied_human_votes", { count: m.excluded.ties }) : null,
    m.excluded.invalid ? t("judgeHumanAgreement.count_with_an_invalid_value", { count: m.excluded.invalid }) : null,
  ].filter(Boolean);
  return parts.length ? t("judgeHumanAgreement.left_out_parts", { parts: parts.join(", ") }) : null;
}

function targetLabel(target: string): string {
  const index = runId.value ? itemIndexOfTarget(target, runId.value) : null;
  return index !== null ? t("judgeHumanAgreement.item_index", { index }) : target;
}
</script>

<template>
  <Card as="section" padding="none" block class="agreement" data-testid="judge-human-agreement">
    <header>
      <h2>{{ t("judgeHumanAgreement.agreement_with_human_labels") }}</h2>
      <slot name="actions" />
    </header>

    <ErrorBanner v-if="agreement.error.value" :error="agreement.error.value" @retry="agreement.run()" />
    <LoadingState v-else-if="agreement.loading.value && !agreement.data.value" size="md" />

    <template v-else>
      <p v-if="!metrics.length" class="muted" data-testid="agreement-empty">
        {{ t("judgeHumanAgreement.no_judge_score_has_a_human") }}
      </p>

      <article v-for="m in metrics" :key="m.name" class="metric" data-testid="agreement-metric">
        <div class="title">
          <strong>{{ m.name }}</strong>
          <span class="muted">{{ m.dataType }} · {{ t("judgeHumanAgreement.judge_label", { label: judgeLabel(m) }) }}</span>
        </div>

        <p v-if="m.status !== 'ok'" class="notice" data-testid="agreement-status">
          {{ m.status === "mixed_judges" ? t("judgeHumanAgreement.scores_of_this_evaluator_come_from") : t("judgeHumanAgreement.judge_and_human_labels_use_different") }}
          <span class="muted">{{ m.reason }}</span>
        </p>

        <template v-else>
          <p v-if="m.lowSample" class="notice" data-testid="agreement-low-sample">{{ lowSampleNote(m.n) }}</p>

          <div class="stats">
            <div v-if="m.dataType !== 'numeric'" class="stat" :class="kappaTone(m.kappa)">
              <span class="value" data-testid="agreement-kappa">{{ formatKappa(m.kappa) }}</span>
              <span class="label">{{ t("judgeHumanAgreement.cohen_s_kappa_label", { label: kappaLabel(m.kappa) }) }}</span>
            </div>
            <div class="stat">
              <span class="value">{{ formatRate(m.percentAgreement) }}</span>
              <span class="label">{{ t("judgeHumanAgreement.exact_agreement") }}</span>
            </div>
            <template v-if="m.dataType === 'numeric'">
              <div class="stat"><span class="value">{{ m.mae === null || m.mae === undefined ? "–" : m.mae.toFixed(2) }}</span><span class="label">{{ t('judgeHumanAgreement.mean_abs_error') }}</span></div>
              <div class="stat"><span class="value">{{ formatKappa(m.spearman) }}</span><span class="label">{{ t("judgeHumanAgreement.spearman") }}</span></div>
              <div class="stat"><span class="value">{{ formatKappa(m.pearson) }}</span><span class="label">{{ t("judgeHumanAgreement.pearson_r") }}</span></div>
              <div class="stat"><span class="value">{{ formatRate(m.withinOne) }}</span><span class="label">{{ t("judgeHumanAgreement.within_1") }}</span></div>
            </template>
            <div class="stat"><span class="value">{{ m.n }}</span><span class="label">{{ t("judgeHumanAgreement.items_compared") }}</span></div>
          </div>
          <p v-if="kappaNote(m)" class="muted">{{ kappaNote(m) }}</p>
          <p v-if="excludedText(m)" class="muted">{{ excludedText(m) }}</p>

          <table v-if="m.confusion" class="confusion" data-testid="agreement-confusion">
            <caption>{{ t("judgeHumanAgreement.rows_human_label_columns_judge") }}</caption>
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
            <h3>{{ t("judgeHumanAgreement.where_they_differ_count", { count: `${m.disagreements.length}${m.disagreements.length >= 100 ? "+" : ""}` }) }}</h3>
            <ul>
              <li v-for="d in m.disagreements.slice(0, 20)" :key="d.target">
                <Button variant="link" v-if="runId && itemIndexOfTarget(d.target, runId) !== null" @click="emit('select-item', itemIndexOfTarget(d.target, runId)!)">{{ targetLabel(d.target) }}</Button>
                <span v-else class="mono">{{ targetLabel(d.target) }}</span>
                <span class="muted">{{ t("judgeHumanAgreement.judge") + " " }}<strong>{{ d.judge }}</strong>{{ " " + t("judgeHumanAgreement.human") + " " }}<strong>{{ d.human }}</strong></span>
              </li>
            </ul>
          </div>
        </template>
      </article>

      <p v-if="traceTargets" class="muted" data-testid="agreement-trace-targets">
        {{ tp("judgeHumanAgreement.traces", traceTargets) }}
      </p>
      <p v-if="unmatched.judgeOnly.length || unmatched.humanOnly.length" class="muted" data-testid="agreement-unmatched">
        {{ t("judgeHumanAgreement.not_compared_because_the_names_don") }}
        <template v-if="unmatched.judgeOnly.length">{{ t('judgeHumanAgreement.evaluators_without_a_human_rubric_names', { names: unmatched.judgeOnly.join(", ") }) }}</template>
        <template v-if="unmatched.judgeOnly.length && unmatched.humanOnly.length">; </template>
        <template v-if="unmatched.humanOnly.length">{{ t('judgeHumanAgreement.human_rubrics_without_an_evaluator_names', { names: unmatched.humanOnly.join(", ") }) }}</template>.
      </p>
      <p v-if="metrics.length && population" class="muted" :class="{ warn: population.tone === 'warn' }" data-testid="agreement-population">{{ population.text }}</p>
      <p v-if="metrics.length && !population" class="muted">
        {{ t("judgeHumanAgreement.agreement_is_only_as_representative_as") }}
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
