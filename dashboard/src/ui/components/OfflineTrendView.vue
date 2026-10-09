<script setup lang="ts">
import type { RunListItemDto } from "@contract";
import { computed } from "vue";
import { useQuasar } from "quasar";
import { formatDateTime, formatPercent } from "@/domain/format";
import {
  buildOfflineSeries,
  judgeChangeNotices,
  offlineAttention,
  offlineEvalChartOption,
  offlineRunLabel,
  offlineVerdict,
  passFailChartOption,
  summarizeEvaluators,
  type EvaluatorStatus,
  type EvaluatorTargets,
  type EvaluatorSummary,
} from "../offline-eval-chart-option";
import EChart from "./EChart.vue";
import DataTable from "./DataTable.vue";
import Card from "./Card.vue";

const props = defineProps<{ runs: RunListItemDto[]; targets?: EvaluatorTargets }>();
const emit = defineEmits<{ "open-run": [run: RunListItemDto]; compare: [ids: [string, string]] }>();

const $q = useQuasar();

const passRateSeries = computed(() => buildOfflineSeries(props.runs, "passRate"));
const averageSeries = computed(() => buildOfflineSeries(props.runs, "average"));
const passRateOption = computed(() => offlineEvalChartOption(props.runs, passRateSeries.value, "passRate", $q.dark.isActive, props.targets));
const averageOption = computed(() => offlineEvalChartOption(props.runs, averageSeries.value, "average", $q.dark.isActive));

const summary = computed(() => summarizeEvaluators(props.runs, props.targets));
const verdict = computed(() => offlineVerdict(summary.value));
const attention = computed(() => offlineAttention(props.runs, summary.value));
function goToAttention(a: (typeof attention.value)[number]) {
  if (a.compare) return emit("compare", a.compare);
  const run = props.runs.find((r) => r.id === a.runId);
  if (run) emit("open-run", run);
}
const passFailOption = computed(() => passFailChartOption(summary.value, $q.dark.isActive));
const hasPassFail = computed(() => summary.value.some((s) => s.kind === "passRate"));
const hasTrend = computed(() => props.runs.length >= 2);
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

/** Polyline normalizada 0-1 → 100x28 para el sparkline de cada tarjeta. */
function sparkPoints(s: EvaluatorSummary): string {
  const h = s.history;
  const lo = s.kind === "passRate" ? 0 : Math.min(...h);
  const hi = s.kind === "passRate" ? 1 : Math.max(...h);
  const span = hi - lo || 1;
  return h.map((v, i) => `${((i / (h.length - 1)) * 100).toFixed(1)},${(26 - ((v - lo) / span) * 24).toFixed(1)}`).join(" ");
}

function itemsLabel(s: EvaluatorSummary): string {
  return s.passed !== null ? `${s.passed} of ${s.count} items passed` : `${s.count} items scored`;
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
    <section class="verdict" :class="verdict.level" role="status">
      <span class="verdict-dot" aria-hidden="true" />
      <div>
        <strong>{{ verdict.title }}</strong>
        <p>{{ verdict.detail }}</p>
      </div>
      <span class="meta">{{ summary.length }} evaluators · {{ runs.length }} runs in range</span>
    </section>

    <section v-if="summary.length" class="attention" aria-label="Needs attention">
      <div class="attention-head">
        <h3>Needs attention</h3>
        <span v-if="attention.length" class="attention-count">{{ attention.length }}</span>
      </div>
      <p v-if="!attention.length" class="all-clear" data-testid="offline-all-clear">Nothing needs your attention in the latest run.</p>
      <button v-for="a in attention" :key="a.key" type="button" class="attn" :class="a.tone" data-testid="offline-attention-item" @click="goToAttention(a)">
        <span class="attn-dot" aria-hidden="true" />
        <span class="attn-text"><strong>{{ a.title }}</strong><span>{{ a.text }}</span></span>
        <span class="attn-cta">{{ a.cta }} →</span>
      </button>
    </section>

    <div v-if="summary.length" class="scorecards">
      <article v-for="s in summary" :key="s.name" class="score" :class="s.tone">
        <header class="score-head">
          <h3>{{ s.name }}</h3>
          <span class="status" :class="s.status" :title="STATUS[s.status].hint">{{ STATUS[s.status].label }}</span>
        </header>
        <div class="score-main">
          <span class="score-value">{{ fmt(s.latest, s.kind) }}</span>
          <span class="score-kind">{{ s.kind === "passRate" ? "pass rate" : "average score" }}</span>
        </div>
        <div v-if="s.kind === 'passRate'" class="bar" role="img" :aria-label="`${fmt(s.latest, s.kind)} pass rate`">
          <span class="bar-fill" :style="{ width: `${(s.latest ?? 0) * 100}%` }" />
          <span class="bar-target" :style="{ left: `${s.target * 100}%` }" :title="`${Math.round(s.target * 100)}% target`" />
        </div>
        <footer class="score-foot">
          <span class="muted">{{ itemsLabel(s) }}</span>
          <span v-if="s.delta !== null" :class="deltaTone(s)">{{ deltaLabel(s) }} vs previous</span>
          <span v-else class="muted">No previous run</span>
        </footer>
        <svg v-if="s.history.length > 1" class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="sparkPoints(s)" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
        </svg>
      </article>
    </div>
    <p v-else class="sub">No evaluator produced numeric or boolean results in this range.</p>

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
      <Card as="section" padding="lg" v-if="hasPassFail" class="card">
        <header class="card-head">
          <div>
            <h3>Latest run: passed vs failed</h3>
            <p class="sub">Items per pass/fail evaluator in the most recent run. Red is what to fix.</p>
          </div>
        </header>
        <EChart :option="passFailOption" :height="`${Math.max(160, summary.length * 64 + 60)}px`" label="Passed and failed items per evaluator in the latest run" />
      </Card>

      <Card as="section" padding="lg" v-if="passRateSeries.length" class="card">
        <header class="card-head">
          <div>
            <h3>Pass rate over runs</h3>
            <p class="sub">Share of items passing each boolean evaluator. Click a point to open its run.</p>
          </div>
        </header>
        <EChart v-if="hasTrend" :option="passRateOption" height="280px" label="Pass rate per evaluator across offline runs" @click="openAt" />
        <p v-else class="empty-trend">Only one run so far. Change your agent and run <code>run_experiment</code> again to see whether it improves.</p>
      </Card>

      <Card as="section" padding="lg" v-if="averageSeries.length" class="card">
        <header class="card-head">
          <div>
            <h3>Average score over runs</h3>
            <p class="sub">Mean of each numeric evaluator. Click a point to open its run.</p>
          </div>
        </header>
        <EChart v-if="hasTrend" :option="averageOption" height="280px" label="Average score per evaluator across offline runs" @click="openAt" />
        <p v-else class="empty-trend">Only one run so far: the trend appears after the next one.</p>
      </Card>
    </div>

    <Card as="section" padding="lg" class="card">
      <header class="card-head">
        <div>
          <h3>Runs</h3>
          <p class="sub">Select a run to inspect its items, or compare two of them.</p>
        </div>
      </header>
      <DataTable>
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
      </DataTable>
    </Card>
  </div>
</template>

<style scoped>
.trend { display: flex; flex-direction: column; gap: 16px; font-family: var(--mt-sans); }

.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
h3 { margin: 0; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.sub { margin: 4px 0 0; color: var(--mt-muted); font-size: 12.5px; }
.meta { color: var(--mt-muted); font-size: 12px; white-space: nowrap; }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 16px; }
.empty-trend { margin: 0; padding: 36px 12px; text-align: center; color: var(--mt-muted); font-size: 13px; }
.empty-trend code { font-family: var(--mt-mono); font-size: 12px; background: var(--mt-soft); padding: 1px 5px; border-radius: var(--mt-radius-sm); }
.verdict { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: var(--mt-card); }
.verdict strong { font-size: 16px; letter-spacing: -0.02em; }
.verdict p { margin: 2px 0 0; color: var(--mt-muted); font-size: 13px; }
.verdict .meta { margin-left: auto; }
.verdict-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; background: var(--mt-muted); }
.verdict.healthy { background: var(--mt-ok-bg); border-color: var(--mt-ok); }
.verdict.healthy .verdict-dot { background: var(--mt-ok); }
.verdict.healthy strong { color: var(--mt-ok-ink); }
.verdict.attention { background: var(--mt-warn-bg); border-color: var(--mt-warn); }
.verdict.attention .verdict-dot { background: var(--mt-warn); }
.verdict.attention strong { color: var(--mt-warn-ink); }
.verdict.failing { background: var(--mt-err-bg); border-color: var(--mt-err); }
.verdict.failing .verdict-dot { background: var(--mt-err); }
.verdict.failing strong { color: var(--mt-err-ink); }
.verdict.healthy p, .verdict.attention p, .verdict.failing p { color: var(--mt-ink); }
.attention { background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); overflow: hidden; }
.attention-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.attention-head h3 { font-weight: 800; }
.attention-count { padding: 1px 7px; border-radius: var(--mt-radius-xs); background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); font-size: 11px; font-weight: 800; }
.all-clear { margin: 0; padding: 4px 16px 16px; color: var(--mt-muted); font-size: 13px; }
.attn { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; border: 0; border-top: 1px solid var(--mt-line-2); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.attn:hover { background: var(--mt-soft-2); }
.attn-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--mt-accent); }
.attn.error .attn-dot { background: var(--mt-err); }
.attn.warn .attn-dot { background: var(--mt-warn); }
.attn-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.attn-text strong { font-weight: 700; }
.attn-text span { font-size: 12px; color: var(--mt-muted); }
.attn-cta { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); }
.scorecards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.score { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); overflow: hidden; color: var(--mt-muted); }
.score-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.score-head h3 { color: var(--mt-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.score-main { display: flex; align-items: baseline; gap: 8px; }
.score-value { color: var(--mt-ink); font-size: 32px; font-weight: 700; letter-spacing: -0.04em; line-height: 1; }
.score.positive .score-value { color: var(--mt-ok-ink); }
.score.warning .score-value { color: var(--mt-warn-ink); }
.score.negative .score-value { color: var(--mt-err-ink); }
.score-kind { font-size: 12px; }
.bar { position: relative; height: 8px; border-radius: 999px; background: var(--mt-soft); overflow: hidden; }
.bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--mt-muted); }
.score.positive .bar-fill { background: var(--mt-ok); }
.score.warning .bar-fill { background: var(--mt-warn); }
.score.negative .bar-fill { background: var(--mt-err); }
.bar-target { position: absolute; left: 80%; top: 0; bottom: 0; width: 2px; background: var(--mt-ink); opacity: 0.35; }
.score-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.spark { width: 100%; height: 28px; color: var(--mt-accent); }
@media (max-width: 640px) { .verdict { flex-wrap: wrap; } .verdict .meta { margin-left: 0; } }
.up { color: var(--mt-ok-ink); font-weight: 600; }
.down { color: var(--mt-err-ink); font-weight: 600; }
.clickable { cursor: pointer; }
.clickable:hover td { background: var(--mt-accent-tint); }
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
