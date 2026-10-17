<script setup lang="ts">
import type { EvaluatorNoiseDto, RunVariabilityResponse } from "@contract";
import { computed, watch } from "vue";
import { formatPercent } from "@/domain/format";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Card from "./Card.vue";
import DataTable from "./DataTable.vue";
import ErrorBanner from "./ErrorBanner.vue";
import Pill from "./Pill.vue";
import { t } from "../i18n";

/**
 * Variabilidad de un run (ADR-097): cuánto se mueve el resultado de cada evaluador entre las ejecuciones de un run lanzado con
 * `repeats=N`, y qué items cambian de resultado. Un run con una sola ejecución no tiene ruido que mostrar: enseña cómo medirlo.
 */
const props = defineProps<{ runId: string }>();
const api = useTraceApi();

const variability = useAsync<RunVariabilityResponse>((signal) => api.getRunVariability(props.runId, signal));
watch(() => props.runId, () => void variability.run(), { immediate: true });

const data = computed(() => variability.data.value);
const repeated = computed(() => !!data.value?.group);
const roughEstimate = computed(() => (data.value?.group?.completed ?? 0) < 3);
const columns = computed(() => data.value?.executions.map((e) => e.index) ?? []);

const fmt = (v: number | null, e: EvaluatorNoiseDto) => (v === null ? "–" : e.dataType === "boolean" ? formatPercent(v) : v.toFixed(2));
const fmtNoise = (e: EvaluatorNoiseDto) => (e.noise === null ? "–" : e.dataType === "boolean" ? `±${(e.noise * 100).toFixed(1)} pp` : `±${e.noise.toFixed(2)}`);
const instabilityOf = (name: string) => data.value?.instability.find((i) => i.evaluator === name) ?? null;
const outcome = (value: string | null) => (value === "true" ? "✓" : value === "false" ? "✕" : (value ?? "–"));
const outcomeTone = (value: string | null): "ok" | "error" | "neutral" => (value === "true" ? "ok" : value === "false" ? "error" : "neutral");
function preview(value: unknown): string {
  if (value === null || value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}

const SNIPPET = `run_experiment(
    data="<dataset_id>", task=agent, evaluators=evaluators,
    name="prompt-v7",
    repeats=3,
)`;
</script>

<template>
  <div class="variability">
    <ErrorBanner v-if="variability.error.value" :error="variability.error.value" @retry="variability.run()" />
    <p v-else-if="variability.loading.value && !data" class="hint">{{ t("runVariability.reading_the_executions") }}</p>

    <template v-else-if="data && repeated">
      <Card as="section" padding="lg" gap="md" class="card">
        <h3>{{ t("runVariability.result_of_each_execution") }}
          <span class="hint">{{ t("runVariability.done_of_total_executions_if_nothing", { done: data.group!.completed, total: data.group!.total }) }}</span>
        </h3>
        <DataTable v-if="data.evaluators.length" class="layout-fixed">
          <thead>
            <tr>
              <th>{{ t("runVariability.evaluator") }}</th>
              <th v-for="n in columns" :key="n" class="num">{{ t('runVariability.exec_n', { n }) }}</th>
              <th class="num">{{ t("runVariability.mean") }}</th>
              <th class="num">{{ t("runVariability.noise") }}</th>
              <th class="num">{{ t("runVariability.unstable_items") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in data.evaluators" :key="e.name" data-testid="variability-row">
              <td><strong>{{ e.name }}</strong></td>
              <td v-for="(v, i) in e.values" :key="i" class="num mono">{{ fmt(v, e) }}</td>
              <td class="num mono">{{ fmt(e.mean, e) }}</td>
              <td class="num mono">{{ fmtNoise(e) }}</td>
              <td class="num mono">{{ instabilityOf(e.name) ? `${instabilityOf(e.name)!.unstable} of ${instabilityOf(e.name)!.total}` : "–" }}</td>
            </tr>
          </tbody>
        </DataTable>
        <p v-else class="hint">{{ t("runVariability.the_executions_have_no_boolean_or") }}</p>
        <p v-if="roughEstimate" class="hint" data-testid="rough-estimate">{{ t("runVariability.with_count_unit_the_noise_is", { count: data.group!.completed, unit: data.group!.completed === 1 ? t("runVariability.executions.one") : t("runVariability.executions.other") }) }}</p>
      </Card>

      <Card as="section" padding="lg" gap="md" class="card">
        <h3>{{ t("runVariability.unstable_items") + " " }}<span class="hint">{{ t("runVariability.items_whose_result_is_not_the") }}</span></h3>
        <p v-if="!data.unstableItems.length" class="hint">{{ t("runVariability.every_item_gave_the_same_result") }}</p>
        <DataTable v-else class="layout-fixed">
          <thead><tr><th>{{ t("runVariability.input") }}</th><th class="ev-col">{{ t("runVariability.evaluator") }}</th><th class="out-col">{{ t("runVariability.executions") }}</th></tr></thead>
          <tbody>
            <tr v-for="item in data.unstableItems" :key="`${item.evaluator}-${item.itemIndex}`" data-testid="unstable-item">
              <td class="preview" :title="preview(item.input)">{{ preview(item.input) }}</td>
              <td>{{ item.evaluator }}</td>
              <td><Pill v-for="(o, i) in item.outcomes" :key="i" :tone="outcomeTone(o)" class="chip">{{ outcome(o) }}</Pill></td>
            </tr>
          </tbody>
        </DataTable>
      </Card>
    </template>

    <Card v-else-if="data" as="section" padding="lg" gap="md" class="card" data-testid="no-repeats">
      <h3>{{ t("runVariability.measure_the_noise_of_this_evaluation") }}</h3>
      <p class="hint">{{ t("runVariability.this_run_has_one_execution_so") }}</p>
      <pre class="snippet">{{ SNIPPET }}</pre>
      <p class="hint">{{ t("runVariability.costs") + " " }}<strong>{{ t("runVariability.n_times") }}</strong>{{ " " + t("runVariability.the_time_and_tokens_the_default") + " " }}<code>repeats: 3</code>.</p>
    </Card>
  </div>
</template>

<style scoped>
.variability { display: flex; flex-direction: column; gap: 16px; min-width: 0; font-family: var(--mt-sans); }
.card { flex-shrink: 0; gap: 10px; }
h3 { margin: 0 0 4px; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
h3 .hint { font-weight: 400; margin-left: 8px; }
.hint { margin: 0; font-size: 12.5px; color: var(--mt-muted); }
.hint code { font-family: var(--mt-mono); font-size: 12px; background: var(--mt-soft); padding: 1px 5px; border-radius: var(--mt-radius-sm); }
.layout-fixed { table-layout: fixed; }
.layout-fixed .preview { max-width: none; }
.num { text-align: right; }
.mono { font-family: var(--mt-mono); font-size: 12.5px; }
.ev-col { width: 140px; }
.out-col { width: 200px; }
.chip { margin-right: 4px; min-width: 26px; justify-content: center; }
.snippet { margin: 0; padding: 12px 14px; border-radius: var(--mt-radius-sm); background: var(--mt-ink); color: var(--mt-card); font-family: var(--mt-mono); font-size: 12px; line-height: 1.6; overflow-x: auto; }
</style>
