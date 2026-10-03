<script setup lang="ts">
import type { RunListItemDto } from "@contract";
import { computed } from "vue";
import { useQuasar } from "quasar";
import { formatDateTime, formatPercent } from "@/domain/format";
import {
  buildOfflineSeries,
  judgeChangeNotices,
  offlineEvalChartOption,
  offlineRunLabel,
  summarizeEvaluators,
  type EvaluatorStatus,
  type EvaluatorSummary,
} from "../offline-eval-chart-option";
import EChart from "./EChart.vue";

const props = defineProps<{ runs: RunListItemDto[] }>();
const emit = defineEmits<{ "open-run": [run: RunListItemDto] }>();

const $q = useQuasar();

const passRateSeries = computed(() => buildOfflineSeries(props.runs, "passRate"));
const averageSeries = computed(() => buildOfflineSeries(props.runs, "average"));
const passRateOption = computed(() => offlineEvalChartOption(props.runs, passRateSeries.value, "passRate", $q.dark.isActive));
const averageOption = computed(() => offlineEvalChartOption(props.runs, averageSeries.value, "average", $q.dark.isActive));

const summary = computed(() => summarizeEvaluators(props.runs));
const judgeNotices = computed(() => judgeChangeNotices(props.runs));
const newestFirst = computed(() => [...props.runs].reverse());

const STATUS: Record<EvaluatorStatus, { label: string; hint: string }> = {
  improving: { label: "Improving", hint: "Higher than the previous run" },
  regressing: { label: "Regressing", hint: "Lower than the previous run" },
  stable: { label: "Stable", hint: "Within noise of the previous run" },
  "judge-changed": { label: "Judge changed", hint: "The judge or rubric differs, so the change is not comparable" },
  "first-run": { label: "Baseline", hint: "Only one run has this evaluator" },
};

function fmt(v: number | null, kind: EvaluatorSummary["kind"]): string {
  if (v === null) return "–";
  return kind === "passRate" ? formatPercent(v) : v.toFixed(2);
}

function deltaLabel(s: EvaluatorSummary): string {
  if (s.delta === null) return "–";
  const sign = s.delta > 0 ? "+" : "";
  return s.kind === "passRate" ? `${sign}${(s.delta * 100).toFixed(1)} pp` : `${sign}${s.delta.toFixed(2)}`;
}

function deltaTone(s: EvaluatorSummary): string {
  if (s.status === "improving") return "up";
  if (s.status === "regressing") return "down";
  return "";
}

/** Un punto de las gráficas corresponde al run con ese índice (mismo orden que `runs`). */
function openAt(index: number) {
  const run = props.runs[index];
  if (run) emit("open-run", run);
}
</script>

<template>
  <div class="trend">
    <section class="card">
      <header class="card-head">
        <div>
          <h3>Evaluators</h3>
          <p class="sub">Latest completed run against the one before it.</p>
        </div>
        <span class="meta">{{ summary.length }} evaluators · {{ runs.length }} runs in range</span>
      </header>

      <div v-if="summary.length" class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Evaluator</th>
              <th>Metric</th>
              <th class="num">Latest</th>
              <th class="num">Δ vs previous</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in summary" :key="s.name">
              <td class="strong">{{ s.name }}</td>
              <td class="muted">{{ s.kind === "passRate" ? "Pass rate" : "Average score" }}</td>
              <td class="num strong">{{ fmt(s.latest, s.kind) }}</td>
              <td class="num" :class="deltaTone(s)">{{ deltaLabel(s) }}</td>
              <td><span class="status" :class="s.status" :title="STATUS[s.status].hint">{{ STATUS[s.status].label }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="sub">No evaluator produced numeric or boolean results in this range.</p>
    </section>

    <div v-if="judgeNotices.length" class="notice" role="alert">
      <strong>The judge changed between runs</strong>
      <p>Pass rates before and after are not directly comparable. Changed points are marked with a red diamond.</p>
      <ul>
        <li v-for="n in judgeNotices" :key="`${n.evaluator}-${n.toRun}`">
          <code>{{ n.evaluator }}</code>: {{ n.fromRun }} → {{ n.toRun }}
        </li>
      </ul>
    </div>

    <div class="charts">
      <section v-if="passRateSeries.length" class="card">
        <header class="card-head">
          <div>
            <h3>Pass rate over runs</h3>
            <p class="sub">Share of items passing each boolean evaluator. Click a point to open its run.</p>
          </div>
        </header>
        <EChart :option="passRateOption" height="280px" label="Pass rate per evaluator across offline runs" @click="openAt" />
      </section>

      <section v-if="averageSeries.length" class="card">
        <header class="card-head">
          <div>
            <h3>Average score over runs</h3>
            <p class="sub">Mean of each numeric evaluator. Click a point to open its run.</p>
          </div>
        </header>
        <EChart :option="averageOption" height="280px" label="Average score per evaluator across offline runs" @click="openAt" />
      </section>
    </div>

    <section class="card">
      <header class="card-head">
        <div>
          <h3>Runs</h3>
          <p class="sub">Select a run to inspect its items, or compare two of them.</p>
        </div>
      </header>
      <div class="table-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th>Run</th>
              <th>Dataset</th>
              <th>Version</th>
              <th class="num">Items</th>
              <th>Created</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in newestFirst" :key="r.id" class="clickable" @click="emit('open-run', r)">
              <td class="strong">{{ offlineRunLabel(r) }}</td>
              <td>{{ r.datasetName }}</td>
              <td class="muted">v{{ r.versionMajor }}.{{ r.versionMinor }}</td>
              <td class="num">{{ r.itemCount }}</td>
              <td class="muted">{{ formatDateTime(r.createdAt) }}</td>
              <td class="actions"><button type="button" class="open" @click.stop="emit('open-run', r)">Open</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.trend { display: flex; flex-direction: column; gap: 16px; font-family: var(--mt-sans); }
.card { background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); padding: 18px 20px; min-width: 0; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.sub { margin: 4px 0 0; color: var(--mt-muted); font-size: 12.5px; }
.meta { color: var(--mt-muted); font-size: 12px; white-space: nowrap; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
.table-wrap { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.tbl th { text-align: left; padding: 8px 10px; color: var(--mt-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--mt-line); white-space: nowrap; }
.tbl td { padding: 10px; border-bottom: 1px solid var(--mt-line); color: var(--mt-ink); }
.tbl tbody tr:last-child td { border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 600; }
.muted { color: var(--mt-muted); }
.up { color: var(--mt-ok-ink); font-weight: 600; }
.down { color: var(--mt-err-ink); font-weight: 600; }
.clickable { cursor: pointer; }
.clickable:hover td { background: var(--mt-soft); }
.status { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid var(--mt-line); white-space: nowrap; }
.status.improving { color: var(--mt-ok-ink); }
.status.regressing { color: var(--mt-err-ink); }
.status.judge-changed { color: var(--mt-err-ink); border-style: dashed; }
.status.stable, .status.first-run { color: var(--mt-muted); }
.actions { text-align: right; width: 1%; }
.open { height: 28px; padding: 0 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: transparent; color: var(--mt-ink); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.open:hover { border-color: var(--mt-accent); color: var(--mt-accent); }
.notice { border: 1px solid var(--mt-err-ink); border-radius: var(--mt-radius-lg); padding: 12px 16px; font-size: 13px; color: var(--mt-ink); }
.notice p { margin: 4px 0; color: var(--mt-muted); }
.notice ul { margin: 4px 0 0; padding-left: 18px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
