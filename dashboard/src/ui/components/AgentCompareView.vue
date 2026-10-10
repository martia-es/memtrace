<script setup lang="ts">
import type { OverviewResponse } from "@contract";
import type { EChartsCoreOption } from "echarts/core";
import { useQuasar } from "quasar";
import { computed } from "vue";
import { compareRows, compareVerdict, costPerExecution, formatCostPerExecution, relativeChange, formatChange, type CompareTone } from "@/domain/agent-compare";
import { formatCostUsd, formatCount, formatDuration } from "@/domain/format";
import { chartColors } from "../chart-theme";
import EChart from "./EChart.vue";
import EmptyState from "./EmptyState.vue";
import ErrorBanner from "./ErrorBanner.vue";
import Select from "./Select.vue";
import LoadingState from "./LoadingState.vue";

const props = defineProps<{
  nameA: string;
  nameB: string;
  a: OverviewResponse | null;
  b: OverviewResponse | null;
  options: { label: string; value: string }[];
  agentBId: string | null;
  loading: boolean;
  error: Error | null;
  /** The time range is long enough that chart labels need the date, not only the hour. */
  longRange: boolean;
}>();
const emit = defineEmits<{ "update:agentBId": [id: string]; swap: []; retry: [] }>();

const $q = useQuasar();

const rows = computed(() => (props.a && props.b ? compareRows(props.a, props.b) : []));
const verdict = computed(() => compareVerdict(rows.value));

/** Half-width of the diverging track is 80 %: bigger changes are clipped so one outlier does not flatten the rest. */
const TRACK_MAX = 0.8;
function bar(change: number | null): { left: string; width: string } {
  const w = (Math.min(Math.abs(change ?? 0), TRACK_MAX) / TRACK_MAX) * 50;
  return { left: `${(change ?? 0) < 0 ? 50 - w : 50}%`, width: `${w}%` };
}
const TONE_LABEL: Record<CompareTone, string> = { better: "better in B", worse: "worse in B", neutral: "neutral" };

const perExec = computed(() => {
  if (!props.a || !props.b) return null;
  const ca = costPerExecution(props.a);
  const cb = costPerExecution(props.b);
  const change = ca !== null && cb !== null ? relativeChange(ca, cb) : null;
  return { a: formatCostPerExecution(ca), b: formatCostPerExecution(cb), change, text: formatChange(change), totalA: formatCostUsd(props.a.totals.costUsd) ?? "–", totalB: formatCostUsd(props.b.totals.costUsd) ?? "–" };
});

/** Each agent's own input / output split (100 % = its total tokens), so the bar reads as "how much is the prompt vs the answer". */
const tokenMix = computed(() => {
  if (!props.a || !props.b) return [];
  return [
    { id: "A", name: props.nameA, o: props.a },
    { id: "B", name: props.nameB, o: props.b },
  ].map(({ id, name, o }) => {
    const total = Math.max(o.totals.inputTokens + o.totals.outputTokens, 1);
    const inputPct = Math.round((o.totals.inputTokens / total) * 100);
    return {
      id,
      name,
      inputPct,
      outputPct: 100 - inputPct,
      input: formatCount(o.totals.inputTokens),
      output: formatCount(o.totals.outputTokens),
      total: formatCount(o.totals.totalTokens),
    };
  });
});

const hour = (iso: string) =>
  new Date(iso).toLocaleString("en-US", props.longRange ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false } : { hour: "2-digit", minute: "2-digit", hour12: false });

function lineOption(aValues: number[], bValues: number[], valueFormatter?: (v: number) => string): EChartsCoreOption {
  const c = chartColors($q.dark.isActive);
  const axis = {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: c.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: c.grid, type: "dashed" as const } },
  };
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    animationDuration: 400,
    grid: { left: 6, right: 6, top: 10, bottom: 6, containLabel: true },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: $q.dark.isActive ? "rgba(22,34,26,0.98)" : "rgba(255,255,255,0.98)",
      textStyle: { color: c.text, fontSize: 12 },
      borderColor: c.grid,
      ...(valueFormatter ? { valueFormatter: (v: unknown) => valueFormatter(Number(v)) } : {}),
    },
    xAxis: { type: "category", boundaryGap: false, data: (props.a?.timeseries ?? []).map((p) => hour(p.bucketStart)), ...axis, splitLine: { show: false }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", ...axis, axisLabel: valueFormatter ? { ...axis.axisLabel, formatter: (v: number) => valueFormatter(v) } : axis.axisLabel },
    series: [
      { name: `A · ${props.nameA}`, type: "line", smooth: 0.35, showSymbol: false, lineStyle: { width: 2.5, color: c.primary }, itemStyle: { color: c.primary }, data: aValues },
      { name: `B · ${props.nameB}`, type: "line", smooth: 0.35, showSymbol: false, lineStyle: { width: 2.5, color: c.accent, type: "dashed" }, itemStyle: { color: c.accent }, data: bValues },
    ],
  };
}
const charts = computed(() => {
  const a = props.a?.timeseries ?? [];
  const b = props.b?.timeseries ?? [];
  return [
    { title: "Executions", option: lineOption(a.map((p) => p.traces), b.map((p) => p.traces)) },
    { title: "Total tokens", option: lineOption(a.map((p) => p.totalTokens), b.map((p) => p.totalTokens), formatCount) },
    { title: "Latency p95", option: lineOption(a.map((p) => p.p95Ms), b.map((p) => p.p95Ms), formatDuration) },
  ];
});
</script>

<template>
  <div class="ac">
    <div class="ac-pick">
      <div class="ac-agent a">
        <span class="ac-badge a">A</span>
        <div class="ac-agent-text"><strong>{{ nameA }}</strong><span>Baseline · set with the agent selector above</span></div>
      </div>
      <button type="button" class="ac-swap" aria-label="Swap A and B" title="Swap A and B" :disabled="!agentBId" @click="emit('swap')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></svg>
      </button>
      <div class="ac-agent b">
        <span class="ac-badge b">B</span>
        <div class="ac-agent-select"><span>Candidate</span><Select :model-value="agentBId" :options="options" placeholder="Choose an agent to compare" @update:model-value="emit('update:agentBId', $event)" /></div>
      </div>
    </div>

    <EmptyState v-if="!agentBId" icon="compare_arrows" title="Pick an agent to compare">Choose the candidate (B) above to compare it against {{ nameA }}.</EmptyState>
    <ErrorBanner v-else-if="error" :error="error" @retry="emit('retry')" />
    <LoadingState v-else-if="loading && !b" size="lg" />

    <template v-else-if="a && b">
      <section class="ac-verdict" :class="verdict.tone">
        <div class="ac-verdict-text">
          <strong>{{ verdict.headline }}</strong>
          <span>{{ verdict.detail }}</span>
        </div>
        <div class="ac-counts">
          <div class="better"><b>{{ verdict.better }}</b><span>Better</span></div>
          <div class="worse"><b>{{ verdict.worse }}</b><span>Worse</span></div>
          <div class="neutral"><b>{{ verdict.neutral }}</b><span>Neutral</span></div>
        </div>
      </section>

      <div class="ac-grid">
        <section class="ac-card ac-deltas">
          <div class="ac-card-head">
            <h3>What changed from A to B</h3>
            <span class="ac-legend"><i class="better" />Better<i class="worse" />Worse<i class="neutral" />Neutral</span>
          </div>
          <div class="ac-delta-row head"><span>Metric</span><span>A → B</span><span class="ac-axis"><span>◀ lower in B</span><span>higher in B ▶</span></span><span class="r">Change</span></div>
          <div v-for="r in rows" :key="r.key" class="ac-delta-row">
            <strong>{{ r.label }}</strong>
            <span class="ac-values">{{ r.a }} → <b>{{ r.b }}</b></span>
            <div class="ac-track" role="img" :aria-label="`${r.label}: ${r.deltaText}, ${TONE_LABEL[r.tone]}`">
              <i class="zero" />
              <i class="bar" :class="r.tone" :style="bar(r.change)" />
            </div>
            <span class="ac-pill" :class="r.tone">{{ r.deltaText }}</span>
          </div>
        </section>

        <div class="ac-side">
          <section v-if="perExec" class="ac-card">
            <h3>Cost per execution</h3>
            <div class="ac-perexec">
              <div><span class="lbl">A</span><span class="old">{{ perExec.a }}</span></div>
              <span class="arrow">→</span>
              <div><span class="lbl b">B</span><span class="new">{{ perExec.b }}</span></div>
              <span class="grow" />
              <span class="ac-pill" :class="perExec.change === null || Math.abs(perExec.change) < 0.05 ? 'neutral' : perExec.change < 0 ? 'better' : 'worse'">{{ perExec.text }}</span>
            </div>
            <p class="ac-note">Total in this range: {{ perExec.totalA }} for A, {{ perExec.totalB }} for B.</p>
          </section>

          <section class="ac-card ac-grow">
            <div class="ac-card-head">
              <h3>Input vs output tokens</h3>
              <span class="ac-legend"><i class="input" />Input (prompt)<i class="output" />Output (answer)</span>
            </div>
            <div v-for="t in tokenMix" :key="t.id" class="ac-mix">
              <div class="ac-mix-head">
                <span class="ac-badge sm" :class="t.id === 'A' ? 'a' : 'b'">{{ t.id }}</span>
                <strong>{{ t.name }}</strong>
                <span class="tot">{{ t.total }} total</span>
              </div>
              <div class="bars" role="img" :aria-label="`${t.name}: ${t.inputPct}% input, ${t.outputPct}% output`">
                <div class="in" :style="{ flexGrow: t.inputPct }">{{ t.inputPct >= 12 ? `${t.inputPct}%` : "" }}</div>
                <div class="out" :style="{ flexGrow: t.outputPct }">{{ t.outputPct >= 12 ? `${t.outputPct}%` : "" }}</div>
              </div>
              <span class="ac-note">{{ t.input }} input · {{ t.output }} output</span>
            </div>
            <p class="ac-note">Each bar is 100% of that agent's tokens. A higher output share means longer answers.</p>
          </section>
        </div>
      </div>

      <div class="ac-charts">
        <section v-for="ch in charts" :key="ch.title" class="ac-card">
          <div class="ac-card-head">
            <h3>{{ ch.title }}</h3>
            <span class="ac-legend"><i class="line-a" />A<i class="line-b" />B</span>
          </div>
          <EChart :option="ch.option" height="190px" :label="`${ch.title} comparison`" />
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ac { display: flex; flex-direction: column; gap: 14px; font-family: var(--mt-sans); }
h3 { margin: 0; font-size: 14px; font-weight: 800; letter-spacing: -0.01em; }

.ac-pick { display: flex; align-items: stretch; gap: 12px; flex-wrap: wrap; }
.ac-agent { flex: 1 1 280px; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--mt-card); border: 1px solid var(--mt-line); border-top-width: 3px; border-radius: var(--mt-radius-lg); }
.ac-agent.a { border-top-color: var(--mt-brand); }
.ac-agent.b { border-top-color: var(--mt-highlight); }
.ac-agent-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ac-agent-text strong { font-size: 14px; }
.ac-agent-text span, .ac-agent-select > span { font-size: 11.5px; color: var(--mt-muted); }
.ac-agent-select { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ac-badge { flex: none; width: 30px; height: 30px; border-radius: var(--mt-radius-sm); display: flex; align-items: center; justify-content: center; font-weight: 800; }
.ac-badge.sm { width: 22px; height: 22px; font-size: 11px; border-radius: 5px; }
.ac-badge.a { background: var(--mt-accent-soft); color: var(--mt-accent); }
.ac-badge.b { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.ac-swap { align-self: center; flex: none; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--mt-line); background: var(--mt-card); color: var(--mt-muted); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.ac-swap:hover:not(:disabled) { color: var(--mt-ink); border-color: var(--mt-muted); }
.ac-swap:disabled { opacity: 0.4; cursor: default; }

.ac-verdict { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 14px 18px; border-radius: var(--mt-radius-lg); border: 1px solid var(--mt-line); background: var(--mt-soft); }
.ac-verdict.good { background: var(--mt-ok-bg); color: var(--mt-ok-ink); border-color: var(--mt-ok); }
.ac-verdict.bad { background: var(--mt-err-bg); color: var(--mt-err-ink); border-color: var(--mt-err); }
.ac-verdict.mixed { background: var(--mt-warn-bg); color: var(--mt-warn-ink); border-color: var(--mt-warn); }
.ac-verdict-text { flex: 1 1 360px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ac-verdict-text strong { font-size: 16px; letter-spacing: -0.01em; }
.ac-verdict-text span { font-weight: 500; font-size: 13px; }
.ac-counts { display: flex; gap: 8px; flex: none; }
.ac-counts > div { min-width: 78px; display: flex; flex-direction: column; align-items: center; padding: 8px 12px; border-radius: var(--mt-radius-lg); background: var(--mt-soft); color: var(--mt-muted); }
.ac-counts .better { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.ac-counts .worse { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.ac-counts b { font-size: 24px; line-height: 1.1; font-weight: 800; }
.ac-counts span { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }

.ac-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 12px; }
.ac-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.ac-card { background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); padding: 14px 16px; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.ac-grow { flex: 1; }
.ac-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ac-note { margin: 0; font-size: 12px; color: var(--mt-muted); }
.ac-legend { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--mt-muted); }
.ac-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-left: 6px; }
.ac-legend i:first-child { margin-left: 0; }
.ac-legend .better { background: var(--mt-ok); } .ac-legend .worse { background: var(--mt-err); } .ac-legend .neutral { background: var(--mt-faint); }
.ac-legend .input { background: var(--mt-ink); } .ac-legend .output { background: var(--mt-muted); }
.ac-legend .line-a { width: 14px; height: 3px; background: var(--mt-brand); }
.ac-legend .line-b { width: 14px; height: 0; border-top: 3px dashed var(--mt-highlight); border-radius: 0; background: none; }

.ac-deltas { padding: 14px 0 0; gap: 0; }
.ac-deltas .ac-card-head { padding: 0 16px 10px; }
.ac-delta-row { display: grid; grid-template-columns: 130px 150px minmax(0, 1fr) 72px; gap: 14px; align-items: center; min-height: 44px; padding: 0 16px; border-top: 1px solid var(--mt-line-2, var(--mt-line)); font-size: 13px; }
.ac-delta-row.head { min-height: 0; padding-bottom: 6px; border-top: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mt-faint); }
.ac-axis { display: flex; justify-content: space-between; text-transform: none; letter-spacing: 0; }
.r { text-align: right; }
.ac-values { font-family: var(--mt-mono); font-size: 12px; color: var(--mt-muted); white-space: nowrap; }
.ac-values b { color: var(--mt-ink); font-weight: 600; }
.ac-track { position: relative; height: 14px; }
.ac-track::before { content: ""; position: absolute; left: 0; right: 0; top: 6px; height: 2px; background: var(--mt-soft); }
.ac-track .zero { position: absolute; left: 50%; top: -2px; width: 1px; height: 18px; background: var(--mt-faint); }
.ac-track .bar { position: absolute; top: 1px; height: 12px; border-radius: 3px; background: var(--mt-faint); transition: width 0.4s ease, left 0.4s ease; }
.ac-track .bar.better { background: var(--mt-ok); } .ac-track .bar.worse { background: var(--mt-err); }
.ac-pill { justify-self: end; height: 22px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: var(--mt-radius-xs, 4px); font-size: 11.5px; font-weight: 800; font-family: var(--mt-mono); background: var(--mt-soft); color: var(--mt-muted); white-space: nowrap; }
.ac-pill.better { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.ac-pill.worse { background: var(--mt-err-bg); color: var(--mt-err-ink); }

.ac-perexec { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.ac-perexec > div { display: flex; flex-direction: column; }
.ac-perexec .lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--mt-muted); }
.ac-perexec .lbl.b { color: var(--mt-highlight-ink); }
.ac-perexec .old { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; color: var(--mt-muted); }
.ac-perexec .new { font-size: 30px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
.ac-perexec .arrow { color: var(--mt-faint); padding-bottom: 4px; }
.ac-perexec .grow { flex: 1; }

.ac-mix { display: flex; flex-direction: column; gap: 6px; }
.ac-mix-head { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; }
.ac-mix-head strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-mix .tot { font-family: var(--mt-mono); font-size: 12px; font-weight: 600; color: var(--mt-muted); }
.ac-mix .bars { display: flex; width: 100%; height: 22px; gap: 2px; }
.ac-mix .in, .ac-mix .out { flex-basis: 0; min-width: 2px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; }
.ac-mix .in { background: var(--mt-ink); border-radius: 4px 0 0 4px; }
.ac-mix .out { background: var(--mt-muted); border-radius: 0 4px 4px 0; }

.ac-charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }

@media (max-width: 1000px) {
  .ac-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .ac-delta-row { grid-template-columns: 1fr auto; row-gap: 6px; padding: 8px 16px; }
  .ac-delta-row.head { display: none; }
  .ac-track { grid-column: 1 / -1; grid-row: 3; }
}
</style>
