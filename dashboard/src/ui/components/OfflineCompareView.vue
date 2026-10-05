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
watch([idA, idB], () => void loaded.run(), { immediate: true });

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
</script>

<template>
  <div class="compare" v-if="runs.length >= 2">
    <div class="toolbar">
      <label class="pick"><span class="lbl">A · baseline</span><Select :model-value="idA" :options="options" placeholder="Select run" @update:model-value="idA = $event" /></label>
      <span class="arrow">→</span>
      <label class="pick"><span class="lbl">B · candidate</span><Select :model-value="idB" :options="options" placeholder="Select run" @update:model-value="idB = $event" /></label>
    </div>

    <p v-if="idA === idB" class="hint">Pick two different runs.</p>
    <template v-else-if="runA && runB">
      <section v-if="!sameDataset" class="notice" role="alert">
        <strong>These runs use different datasets</strong> ({{ runA.datasetName }} vs {{ runB.datasetName }}). Aggregates are shown but the differences are not a like-for-like comparison.
      </section>

      <section class="card">
        <h3>Metrics</h3>
        <table class="tbl">
          <thead><tr><th>Evaluator</th><th>A</th><th>B</th><th>Δ</th><th></th></tr></thead>
          <tbody>
            <tr v-for="d in deltas" :key="d.name">
              <td>{{ d.name }}</td>
              <td>{{ fmt(d.a, d.isRate) }}</td>
              <td>{{ fmt(d.b, d.isRate) }}</td>
              <td :class="['delta', tone(d.delta)]">{{ fmtDelta(d.delta, d.isRate) }}</td>
              <td><span v-if="d.judgeChanged" class="warn" title="The judge model or rubric differs between A and B (ADR-043)">⚠ judge changed</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="!deltas.length" class="hint">Neither run has numeric or boolean evaluators.</p>
      </section>

      <ErrorBanner v-if="loaded.error.value" :error="loaded.error.value" @retry="loaded.run()" />
      <div v-else-if="loaded.loading.value" class="hint">Loading items, traces and dataset changes…</div>

      <template v-else-if="loaded.data.value">
        <section class="card">
          <h3>Dataset</h3>
          <p v-if="sameVersion" class="hint">Same dataset version (v{{ runA.versionMajor }}.{{ runA.versionMinor }}): the difference does not come from the data.</p>
          <template v-else-if="sameDataset && loaded.data.value.diff">
            <p class="hint">
              v{{ loaded.data.value.diff.base?.major }}.{{ loaded.data.value.diff.base?.minor }} →
              v{{ loaded.data.value.diff.target.major }}.{{ loaded.data.value.diff.target.minor }}:
              +{{ diffCounts.added }} added, ~{{ diffCounts.modified }} modified, −{{ diffCounts.removed }} removed, {{ loaded.data.value.diff.unchangedCount }} unchanged.
              Metrics may move because the items changed, not only the agent.
            </p>
            <table v-if="changes.length" class="tbl">
              <thead><tr><th>Change</th><th>Input</th></tr></thead>
              <tbody>
                <tr v-for="c in changes.slice(0, SHOWN)" :key="c.originItemId">
                  <td><span class="tag" :class="c.kind">{{ c.kind }}</span></td>
                  <td class="preview" :title="preview((c.after ?? c.before)?.input)">{{ preview((c.after ?? c.before)?.input) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="changes.length > SHOWN" class="hint">Showing {{ SHOWN }} of {{ changes.length }} changes.</p>
          </template>
          <p v-else class="hint">The dataset version diff is not available for these runs.</p>
        </section>

        <section class="card">
          <h3>Items <span class="hint">({{ loaded.data.value.pairing.paired.length }} in both · {{ loaded.data.value.pairing.onlyA.length }} only in A · {{ loaded.data.value.pairing.onlyB.length }} only in B)</span></h3>
          <p class="hint">Items are matched by identical input. {{ regressions }} regressed, {{ improvements }} improved.</p>
          <table v-if="flips.length" class="tbl">
            <thead><tr><th>Input</th><th>Evaluator</th><th>A → B</th><th>Dataset</th></tr></thead>
            <tbody>
              <tr v-for="(f, i) in flips.slice(0, SHOWN)" :key="`${f.pair.key}-${f.evaluator}-${i}`">
                <td class="preview" :title="preview(f.pair.a.input)">{{ preview(f.pair.a.input) }}</td>
                <td>{{ f.evaluator }}</td>
                <td :class="['delta', f.outcome === 'improved' ? 'up' : 'down']">{{ f.before }} → {{ f.after }}</td>
                <td><span v-if="datasetChangeFor(changes, f.pair.a.input)" class="tag modified">{{ datasetChangeFor(changes, f.pair.a.input)!.kind }}</span><span v-else class="hint">–</span></td>
              </tr>
            </tbody>
          </table>
          <p v-if="flips.length > SHOWN" class="hint">Showing {{ SHOWN }} of {{ flips.length }}; regressions first.</p>
        </section>

        <section class="card">
          <h3>Latency</h3>
          <table v-if="hasLatency" class="tbl">
            <thead><tr><th></th><th>A</th><th>B</th></tr></thead>
            <tbody>
              <tr><td>p50</td><td>{{ latencyCell(loaded.data.value.latA, "p50") }}</td><td>{{ latencyCell(loaded.data.value.latB, "p50") }}</td></tr>
              <tr><td>p95</td><td>{{ latencyCell(loaded.data.value.latA, "p95") }}</td><td>{{ latencyCell(loaded.data.value.latB, "p95") }}</td></tr>
              <tr><td>tokens in / out</td><td>{{ loaded.data.value.latA.inputTokens }} / {{ loaded.data.value.latA.outputTokens }}</td><td>{{ loaded.data.value.latB.inputTokens }} / {{ loaded.data.value.latB.outputTokens }}</td></tr>
              <tr><td>cost</td><td>{{ costCell(loaded.data.value.latA) }}</td><td>{{ costCell(loaded.data.value.latB) }}</td></tr>
              <tr><td>items with trace</td><td>{{ loaded.data.value.latA.count }} / {{ loaded.data.value.latA.total }}</td><td>{{ loaded.data.value.latB.count }} / {{ loaded.data.value.latB.total }}</td></tr>
            </tbody>
          </table>
          <p v-else class="hint">Latency is not recorded for these runs: no item has a linked trace (ADR-044). Call <code>memtrace.init_tracer()</code> before <code>run_experiment</code>.</p>
        </section>
      </template>
    </template>
  </div>
  <p v-else class="hint">At least two completed runs are needed to compare.</p>
</template>

<style scoped>
.compare { display: flex; flex-direction: column; gap: 14px; }
.toolbar { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
.pick { display: flex; flex-direction: column; gap: 4px; min-width: 260px; }
.lbl { font-size: 11px; opacity: 0.7; }
.arrow { padding-bottom: 8px; }
.hint { margin: 0; font-size: 12px; opacity: 0.7; }
h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.card { border: 1px solid var(--mt-border, rgba(128, 128, 128, 0.25)); border-radius: 8px; padding: 14px 16px; }
.notice { border: 1px solid var(--q-negative, #b3261e); border-radius: 8px; padding: 10px 14px; font-size: 12px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th, .tbl td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mt-border, rgba(128, 128, 128, 0.2)); }
.preview { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.delta { font-weight: 600; }
.delta.up { color: var(--q-positive, #2e7d32); }
.delta.down, .warn { color: var(--q-negative, #b3261e); }
.tag { font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--mt-border, rgba(128, 128, 128, 0.4)); }
</style>
