<script setup lang="ts">
import type { DatasetItemChangeDto, DatasetVersionDiffResponse, RunListItemDto } from "@contract";
import { computed, ref, watch } from "vue";
import { formatDateTime, formatDuration, formatPercent } from "@/domain/format";
import { offlineRunLabel } from "../offline-eval-chart-option";
import { datasetChangeFor, evaluatorDeltas, itemFlips, pairItems, summarizeTelemetry, type TelemetrySummary } from "../offline-eval-compare";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import ErrorBanner from "./ErrorBanner.vue";
import Select from "./Select.vue";
import NoiseVerdict from "./NoiseVerdict.vue";
import Pill from "./Pill.vue";
import DataTable from "./DataTable.vue";
import Card from "./Card.vue";
import { t } from "../i18n";

const props = defineProps<{ runs: RunListItemDto[]; /** baseline and candidate chosen elsewhere (Evaluations → Compare runs) */ initialIds?: [string, string] | null }>();

const api = useTraceApi();

const options = computed(() => [...props.runs].reverse().map((r) => ({ label: `${offlineRunLabel(r)} · ${formatDateTime(r.createdAt)}`, value: r.id })));
const idA = ref<string | null>(props.initialIds?.[0] ?? null);
const idB = ref<string | null>(props.initialIds?.[1] ?? null);
watch(
  () => props.runs,
  (runs) => {
    if (!runs.some((r) => r.id === idB.value)) idB.value = runs[runs.length - 1]?.id ?? null;
    if (!runs.some((r) => r.id === idA.value)) idA.value = runs[runs.length - 2]?.id ?? null;
  },
  { immediate: true },
);
const runA = computed(() => props.runs.find((r) => r.id === idA.value) ?? null);
const runB = computed(() => props.runs.find((r) => r.id === idB.value) ?? null);

const sameDataset = computed(() => !!runA.value && !!runB.value && runA.value.datasetId === runB.value.datasetId);
const sameVersion = computed(() => sameDataset.value && runA.value!.versionMajor === runB.value!.versionMajor && runA.value!.versionMinor === runB.value!.versionMinor);

const deltas = computed(() => (runA.value && runB.value ? evaluatorDeltas(runA.value, runB.value) : []));

interface Loaded {
  pairing: ReturnType<typeof pairItems>;
  latA: TelemetrySummary;
  latB: TelemetrySummary;
  diff: DatasetVersionDiffResponse | null;
}

const loaded = useAsync<Loaded | null>(async (signal) => {
  const a = runA.value;
  const b = runB.value;
  if (!a || !b || a.id === b.id) return null;
  const [da, db] = await Promise.all([api.getDatasetRun(a.datasetId, a.id, signal), api.getDatasetRun(b.datasetId, b.id, signal)]);
  let diff: DatasetVersionDiffResponse | null = null;
  if (sameDataset.value && !sameVersion.value) {
    const versions = (await api.listDatasetVersions(a.datasetId, signal)).items;
    const find = (r: RunListItemDto) => versions.find((v) => v.major === r.versionMajor && v.minor === r.versionMinor);
    const va = find(a);
    const vb = find(b);
    if (va && vb) {
      const [older, newer] = va.major * 1e6 + va.minor <= vb.major * 1e6 + vb.minor ? [va, vb] : [vb, va];
      diff = await api.getDatasetVersionDiff(a.datasetId, newer.id, older.id, signal);
    }
  }
  return { pairing: pairItems(da.items, db.items), latA: summarizeTelemetry(da.items), latB: summarizeTelemetry(db.items), diff };
});
/** Veredicto frente al ruido de cada evaluador (ADR-097). Es un añadido: si falla, la comparación se ve igual que antes. */
const noise = useAsync(async (signal) => {
  if (!idA.value || !idB.value || idA.value === idB.value) return null;
  return api.compareRunsNoise(idA.value, idB.value, signal);
});
const verdictFor = (name: string) => noise.data.value?.evaluators.find((e) => e.name === name) ?? null;
/** El color de la diferencia solo cuenta si supera el ruido: dentro del ruido no hay evidencia de que sea real. */
function deltaTone(d: { name: string; delta: number | null }): "neutral" | "ok" | "error" {
  if (d.delta === null || d.delta === 0 || verdictFor(d.name)?.verdict === "within") return "neutral";
  return d.delta > 0 ? "ok" : "error";
}
watch([idA, idB], () => { void loaded.run(); void noise.run(); }, { immediate: true });

const changes = computed<DatasetItemChangeDto[]>(() => loaded.data.value?.diff?.changes ?? []);
const flips = computed(() => (loaded.data.value ? itemFlips(loaded.data.value.pairing.paired) : []));
const regressions = computed(() => flips.value.filter((f) => f.outcome === "regressed").length);
const improvements = computed(() => flips.value.filter((f) => f.outcome === "improved").length);
const diffCounts = computed(() => ({
  added: changes.value.filter((c) => c.kind === "added").length,
  modified: changes.value.filter((c) => c.kind === "modified").length,
  removed: changes.value.filter((c) => c.kind === "removed").length,
}));

function fmt(v: number | null, isRate: boolean): string {
  if (v === null) return "–";
  return isRate ? formatPercent(v) : v.toFixed(2);
}
function fmtDelta(d: number | null, isRate: boolean): string {
  if (d === null) return "–";
  const sign = d > 0 ? "+" : "";
  return isRate ? `${sign}${(d * 100).toFixed(1)} pp` : `${sign}${d.toFixed(2)}`;
}
function tone(d: number | null): string {
  return d === null || d === 0 ? "" : d > 0 ? "up" : "down";
}
function preview(value: unknown): string {
  if (value === null || value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}
function latencyCell(s: TelemetrySummary | undefined, key: "p50" | "p95"): string {
  return s && s[key] !== null ? formatDuration(s[key]!) : "–";
}
function costCell(s: TelemetrySummary): string {
  return s.costUsd === null ? "–" : `$${s.costUsd.toFixed(4)}`;
}
const hasLatency = computed(() => !!loaded.data.value && (loaded.data.value.latA.count > 0 || loaded.data.value.latB.count > 0));
const SHOWN = 20;

/** Bar width (%) for a metric value; rates live in 0-1, other averages scale to the larger of the two runs. */
function barWidth(v: number | null, d: { a: number | null; b: number | null; isRate: boolean }): string {
  if (v === null) return "0%";
  const scale = d.isRate ? 1 : Math.max(d.a ?? 0, d.b ?? 0, 1);
  return `${Math.max(2, Math.min(100, (v / scale) * 100))}%`;
}

interface LatencyRow { label: string; a: number | null; b: number | null }
const latencyRows = computed<LatencyRow[]>(() => {
  const l = loaded.data.value;
  if (!l) return [];
  return [
    { label: "p50", a: l.latA.p50, b: l.latB.p50 },
    { label: "p95", a: l.latA.p95, b: l.latB.p95 },
  ].filter((r) => r.a !== null || r.b !== null);
});
function latWidth(v: number | null, r: LatencyRow): string {
  if (v === null) return "0%";
  return `${Math.max(2, (v / Math.max(r.a ?? 0, r.b ?? 0)) * 100)}%`;
}
/** Latency: lower is better, so a drop is the good direction. */
function latDelta(r: LatencyRow): { text: string; tone: "neutral" | "ok" | "error" } {
  if (r.a === null || r.b === null || r.a === 0) return { text: "–", tone: "neutral" };
  const pct = ((r.b - r.a) / r.a) * 100;
  if (Math.abs(pct) < 1) return { text: "≈ 0%", tone: "neutral" };
  return { text: `${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`, tone: pct < 0 ? "ok" : "error" };
}
const unchangedPairs = computed(() => {
  const l = loaded.data.value;
  if (!l) return 0;
  const flipped = new Set(flips.value.map((f) => f.pair.key));
  return l.pairing.paired.length - flipped.size;
});
const netVerdict = computed(() => (regressions.value === 0 && improvements.value === 0 ? "neutral" : improvements.value >= regressions.value ? (regressions.value === 0 ? "good" : "mixed") : "bad"));
</script>

<template>
  <div class="compare" v-if="runs.length >= 2">
    <div class="toolbar">
      <label class="pick"><span class="lbl">{{ t("offlineCompareView.a_baseline") }}</span><Select :model-value="idA" :options="options" :placeholder="t('offlineCompareView.select_run')" @update:model-value="idA = $event" /></label>
      <span class="arrow">→</span>
      <label class="pick"><span class="lbl">{{ t("offlineCompareView.b_candidate") }}</span><Select :model-value="idB" :options="options" :placeholder="t('offlineCompareView.select_run')" @update:model-value="idB = $event" /></label>
    </div>

    <p v-if="idA === idB" class="hint">{{ t("offlineCompareView.pick_two_different_runs") }}</p>
    <template v-else-if="runA && runB">
      <section v-if="!sameDataset" class="notice" role="alert">
        <strong>{{ t("offlineCompareView.these_runs_use_different_datasets") }}</strong> {{ t("offlineCompareView.a_vs_b_aggregates_are_shown", { a: runA.datasetName, b: runB.datasetName }) }}
      </section>

      <section class="runs-strip">
        <div class="run-chip a"><span class="tag-ab">{{ t("offlineCompareView.a_baseline") }}</span><strong>{{ offlineRunLabel(runA) }}</strong><span class="meta">{{ runA.datasetName }} v{{ runA.versionMajor }}.{{ runA.versionMinor }} · {{ formatDateTime(runA.createdAt) }}</span></div>
        <span class="strip-arrow">→</span>
        <div class="run-chip b"><span class="tag-ab">{{ t("offlineCompareView.b_candidate") }}</span><strong>{{ offlineRunLabel(runB) }}</strong><span class="meta">{{ runB.datasetName }} v{{ runB.versionMajor }}.{{ runB.versionMinor }} · {{ formatDateTime(runB.createdAt) }}</span></div>
      </section>

      <Card as="section" padding="lg" gap="md" class="card">
        <div class="card-head"><h3>{{ t("offlineCompareView.metrics") }}</h3><span class="legend"><i class="sw a" /> A <i class="sw b" /> B</span></div>
        <div v-for="d in deltas" :key="d.name" class="metric">
          <div class="metric-name">
            <strong>{{ d.name }}</strong>
            <Pill tone="warn" v-if="d.judgeChanged" :title="t('offlineCompareView.the_judge_model_or_rubric_differs')">{{ t("offlineCompareView.judge_changed") }}</Pill>
          </div>
          <div class="bars">
            <div class="bar-row"><div class="track"><div class="fill a" :style="{ width: barWidth(d.a, d) }" /></div><span class="val">{{ fmt(d.a, d.isRate) }}</span></div>
            <div class="bar-row"><div class="track"><div class="fill b" :class="tone(d.delta)" :style="{ width: barWidth(d.b, d) }" /></div><span class="val">{{ fmt(d.b, d.isRate) }}</span></div>
          </div>
          <div class="delta-cell">
            <Pill :tone="deltaTone(d)" class="delta-pill">{{ d.delta !== null && d.delta !== 0 ? (d.delta > 0 ? "▲ " : "▼ ") : "" }}{{ fmtDelta(d.delta, d.isRate) }}</Pill>
            <NoiseVerdict v-if="verdictFor(d.name)" :comparison="verdictFor(d.name)!" />
          </div>
        </div>
        <p v-if="!deltas.length" class="hint">{{ t("offlineCompareView.neither_run_has_numeric_or_boolean") }}</p>
      </Card>

      <ErrorBanner v-if="loaded.error.value" :error="loaded.error.value" @retry="loaded.run()" />
      <div v-else-if="loaded.loading.value" class="hint">{{ t("offlineCompareView.loading_items_traces_and_dataset_changes") }}</div>

      <template v-else-if="loaded.data.value">
        <Card as="section" padding="lg" gap="md" class="card">
          <h3>{{ t("offlineCompareView.dataset") }}</h3>
          <p v-if="sameVersion" class="hint">{{ t("offlineCompareView.same_dataset_version_v_version_the", { version: `${runA.versionMajor}.${runA.versionMinor}` }) }}</p>
          <template v-else-if="sameDataset && loaded.data.value.diff">
            <p class="hint">
              v{{ loaded.data.value.diff.base?.major }}.{{ loaded.data.value.diff.base?.minor }} →
              v{{ loaded.data.value.diff.target.major }}.{{ loaded.data.value.diff.target.minor }}:
              +{{ diffCounts.added }} added, ~{{ diffCounts.modified }} modified, −{{ diffCounts.removed }} removed, {{ loaded.data.value.diff.unchangedCount }} unchanged.
              Metrics may move because the items changed, not only the agent.
            </p>
            <DataTable v-if="changes.length">
              <thead><tr><th>{{ t("offlineCompareView.change") }}</th><th>{{ t("offlineCompareView.input") }}</th></tr></thead>
              <tbody>
                <tr v-for="c in changes.slice(0, SHOWN)" :key="c.originItemId">
                  <td><Pill :tone="c.kind === 'added' ? 'ok' : c.kind === 'removed' ? 'error' : 'warn'">{{ c.kind }}</Pill></td>
                  <td class="preview" :title="preview((c.after ?? c.before)?.input)">{{ preview((c.after ?? c.before)?.input) }}</td>
                </tr>
              </tbody>
            </DataTable>
            <p v-if="changes.length > SHOWN" class="hint">{{ t("offlineCompareView.showing.changes", { shown: SHOWN, total: changes.length }) }}</p>
          </template>
          <p v-else class="hint">{{ t("offlineCompareView.the_dataset_version_diff_is_not") }}</p>
        </Card>

        <Card as="section" padding="lg" gap="md" class="card">
          <h3>{{ t('offlineCompareView.items') }} <span class="hint">{{ t('offlineCompareView.both_in_both_a_only_in', { both: loaded.data.value.pairing.paired.length, a: loaded.data.value.pairing.onlyA.length, b: loaded.data.value.pairing.onlyB.length }) }}</span></h3>
          <div class="outcomes" :class="netVerdict">
            <div class="outcome bad"><strong>{{ regressions }}</strong><span>{{ t("offlineCompareView.regressed") }}</span></div>
            <div class="outcome good"><strong>{{ improvements }}</strong><span>{{ t("offlineCompareView.improved") }}</span></div>
            <div class="outcome flat"><strong>{{ unchangedPairs }}</strong><span>{{ t("offlineCompareView.unchanged") }}</span></div>
          </div>
          <div v-if="loaded.data.value.pairing.paired.length" class="stack" aria-hidden="true">
            <div class="seg bad" :style="{ flex: regressions }" />
            <div class="seg good" :style="{ flex: improvements }" />
            <div class="seg flat" :style="{ flex: unchangedPairs }" />
          </div>
          <p class="hint">{{ t("offlineCompareView.items_are_matched_by_identical_input") }}</p>
          <DataTable v-if="flips.length">
            <thead><tr><th>{{ t("offlineCompareView.input") }}</th><th>{{ t("offlineCompareView.evaluator") }}</th><th>A → B</th><th>{{ t("offlineCompareView.dataset") }}</th></tr></thead>
            <tbody>
              <tr v-for="(f, i) in flips.slice(0, SHOWN)" :key="`${f.pair.key}-${f.evaluator}-${i}`">
                <td class="preview" :title="preview(f.pair.a.input)">{{ preview(f.pair.a.input) }}</td>
                <td class="strong">{{ f.evaluator }}</td>
                <td><Pill :tone="f.outcome === 'improved' ? 'ok' : 'error'">{{ f.before }} → {{ f.after }}</Pill></td>
                <td><Pill tone="warn" v-if="datasetChangeFor(changes, f.pair.a.input)">{{ datasetChangeFor(changes, f.pair.a.input)!.kind }}</Pill><span v-else class="hint">–</span></td>
              </tr>
            </tbody>
          </DataTable>
          <p v-if="flips.length > SHOWN" class="hint">{{ t("offlineCompareView.showing.flips", { shown: SHOWN, total: flips.length }) }}</p>
        </Card>

        <Card as="section" padding="lg" gap="md" class="card">
          <h3>{{ t("offlineCompareView.latency") }}</h3>
          <template v-if="hasLatency">
            <div v-for="r in latencyRows" :key="r.label" class="metric">
              <div class="metric-name"><strong>{{ r.label }}</strong></div>
              <div class="bars">
                <div class="bar-row"><div class="track"><div class="fill a" :style="{ width: latWidth(r.a, r) }" /></div><span class="val">{{ r.a !== null ? formatDuration(r.a) : "–" }}</span></div>
                <div class="bar-row"><div class="track"><div class="fill b" :style="{ width: latWidth(r.b, r) }" /></div><span class="val">{{ r.b !== null ? formatDuration(r.b) : "–" }}</span></div>
              </div>
              <Pill :tone="latDelta(r).tone" class="delta-pill">{{ latDelta(r).text }}</Pill>
            </div>
            <div class="facts">
              <div class="fact"><span>{{ t("offlineCompareView.tokens_in_out") }}</span><strong>{{ loaded.data.value.latA.inputTokens }} / {{ loaded.data.value.latA.outputTokens }}</strong><i>→</i><strong>{{ loaded.data.value.latB.inputTokens }} / {{ loaded.data.value.latB.outputTokens }}</strong></div>
              <div class="fact"><span>{{ t("offlineCompareView.cost") }}</span><strong>{{ costCell(loaded.data.value.latA) }}</strong><i>→</i><strong>{{ costCell(loaded.data.value.latB) }}</strong></div>
              <div class="fact"><span>{{ t("offlineCompareView.items_with_trace") }}</span><strong>{{ loaded.data.value.latA.count }} / {{ loaded.data.value.latA.total }}</strong><i>→</i><strong>{{ loaded.data.value.latB.count }} / {{ loaded.data.value.latB.total }}</strong></div>
            </div>
          </template>
          <p v-else class="hint">{{ t("offlineCompareView.latency_is_not_recorded_for_these") + " " }}<code>memtrace.init_tracer()</code>{{ " " + t("offlineCompareView.before") + " " }}<code>run_experiment</code>.</p>
        </Card>
      </template>
    </template>
  </div>
  <p v-else class="hint">{{ t("offlineCompareView.at_least_two_completed_runs_are") }}</p>
</template>

<style scoped>
.compare { display: flex; flex-direction: column; gap: 16px; font-family: var(--mt-sans); }
.toolbar { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.pick { display: flex; flex-direction: column; gap: 4px; min-width: 260px; }
.lbl { color: var(--mt-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.arrow { padding-bottom: 8px; color: var(--mt-muted); }
.hint { margin: 0; font-size: 12.5px; color: var(--mt-muted); }
.hint code { font-family: var(--mt-mono); font-size: 12px; background: var(--mt-soft); padding: 1px 5px; border-radius: var(--mt-radius-sm); }
h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
h3 .hint { font-weight: 400; }

.card-head { display: flex; justify-content: space-between; align-items: center; }
.notice { border: 1px solid var(--mt-warn); background: var(--mt-warn-bg); color: var(--mt-warn-ink); border-radius: var(--mt-radius-lg); padding: 10px 14px; font-size: 12.5px; }

.runs-strip { display: flex; align-items: stretch; gap: 12px; flex-wrap: wrap; }
.strip-arrow { align-self: center; font-size: 20px; color: var(--mt-faint); }
.run-chip { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 3px; padding: 12px 16px; border-radius: var(--mt-radius-lg); border: 1px solid var(--mt-line); border-left-width: 4px; background: var(--mt-card); }
.run-chip.a { border-left-color: var(--mt-faint); }
.run-chip.b { border-left-color: var(--mt-accent); background: var(--mt-accent-tint); }
.tag-ab { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--mt-muted); }
.run-chip strong { font-size: 15px; letter-spacing: -0.01em; }
.meta { font-size: 12px; color: var(--mt-muted); }

.legend { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mt-muted); }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.sw.a, .fill.a { background: var(--mt-faint); opacity: 0.55; }
.sw.b, .fill.b { background: var(--mt-accent); }
.fill.b.up { background: var(--mt-ok); }
.fill.b.down { background: var(--mt-err); }

.metric { display: grid; grid-template-columns: 170px 1fr 230px; align-items: center; gap: 16px; padding: 10px 0; border-top: 1px solid var(--mt-line-2); }
.metric:first-of-type { border-top: 0; }
.metric-name { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
.metric-name strong { font-size: 13px; overflow-wrap: anywhere; }
.bars { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.bar-row { display: flex; align-items: center; gap: 10px; }
.track { flex: 1; height: 10px; border-radius: 5px; background: var(--mt-soft); overflow: hidden; }
.fill { height: 100%; border-radius: 5px; transition: width 0.4s ease; }
.val { width: 64px; text-align: right; font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
.delta-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
.delta-pill { font-size: 13px; padding: 4px 10px; }

.outcomes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.outcome { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-radius: var(--mt-radius-lg); background: var(--mt-soft); }
.outcome strong { font-size: 26px; letter-spacing: -0.03em; line-height: 1.1; }
.outcome span { font-size: 12px; font-weight: 600; color: var(--mt-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.outcome.bad { background: var(--mt-err-bg); } .outcome.bad strong { color: var(--mt-err-ink); }
.outcome.good { background: var(--mt-ok-bg); } .outcome.good strong { color: var(--mt-ok-ink); }
.stack { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; }
.seg.bad { background: var(--mt-err); } .seg.good { background: var(--mt-ok); } .seg.flat { background: var(--mt-line); }

.facts { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--mt-line-2); }
.fact { display: flex; align-items: baseline; gap: 10px; font-size: 13px; font-variant-numeric: tabular-nums; }
.fact span { width: 170px; color: var(--mt-muted); }
.fact i { font-style: normal; color: var(--mt-faint); }

@media (max-width: 720px) {
  .metric { grid-template-columns: 1fr; gap: 8px; }
  .outcomes { grid-template-columns: 1fr; }
}
</style>
