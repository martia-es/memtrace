<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { BreakdownResponse, MonthCostDto } from "@contract";
import { costTrendOf, type CostTrendState } from "@/domain/cost-trend";
import { formatCostUsd } from "@/domain/format";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Card from "./Card.vue";
import Pill from "./Pill.vue";
import SegmentedControl from "./SegmentedControl.vue";
import { t, tp } from "../i18n";
import { tr, lazyMessages } from "../../domain/translate";

/**
 * Overview › Summary: gasto del mes, previsión a fin de mes y en qué se va. El mes es siempre el natural (no sigue al rango del
 * Overview) porque el presupuesto es mensual. La previsión es la misma regla que el aviso por email (ADR-086).
 */
const props = defineProps<{ cost: MonthCostDto; budgetUsd: number | null; now: Date; canSetBudget: boolean }>();
defineEmits<{ setBudget: [] }>();

const route = useRoute();
const router = useRouter();
const api = useTraceApi();
const trend = computed(() => costTrendOf(props.cost, props.budgetUsd === null ? null : { monthlyUsd: props.budgetUsd }, props.now));

// ---- gráfica: x en días desde el inicio del mes, y en USD
const W = 700, H = 300, LEFT = 44, RIGHT = 684, TOP = 16, BOTTOM = 272;
const yMax = computed(() => {
  const t = trend.value;
  const top = Math.max(t.monthlyUsd ?? 0, t.projectedUsd ?? 0, t.spentUsd) * 1.1 || 1;
  const step = 10 ** Math.floor(Math.log10(top / 4));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => top / s <= 5) ?? step * 10;
  return Math.ceil(top / nice) * nice;
});
const X = (d: number) => LEFT + (d / trend.value.daysInMonth) * (RIGHT - LEFT);
const Y = (v: number) => BOTTOM - (v / yMax.value) * (BOTTOM - TOP);
const points = (a: Array<{ x: number; y: number }>) => a.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
const ticks = computed(() => Array.from({ length: 5 }, (_, i) => (yMax.value / 4) * i).map((v) => ({ y: Y(v), label: `$${Math.round(v)}` })));
const maxDaily = computed(() => Math.max(0, ...trend.value.bars.map((b) => b.costUsd)));
const bars = computed(() => trend.value.bars.map((b) => {
  const h = maxDaily.value > 0 ? (b.costUsd / maxDaily.value) * 48 : 0;
  return { key: b.day, x: X(b.day - 0.5) - 7, y: BOTTOM - h, h };
}));
const xLabels = computed(() => [1, 5, 10, 15, 20, 25, trend.value.daysInMonth].filter((d, i, a) => a.indexOf(d) === i).map((d) => ({ x: X(d - 0.5), label: `${trend.value.monthLabel} ${d}` })));
const today = computed(() => ({ x: X(trend.value.elapsedDays), y: Y(trend.value.spentUsd) }));
const end = computed(() => (trend.value.projectedUsd === null ? null : { x: X(trend.value.daysInMonth), y: Y(trend.value.projectedUsd) }));
const cross = computed(() => (trend.value.crossDay === null ? null : X(trend.value.crossDay - 0.5)));

const usd = (v: number | null) => formatCostUsd(v) ?? "$0";
const budgetOf = computed(() => trend.value.monthlyUsd);
const STATES: Record<CostTrendState, { tone: "ok" | "warn" | "error" | "neutral"; label: string }> = {
  on_track: { tone: "ok", get label() { return t("costTrendCard.on_track"); } },
  forecast: { tone: "warn", get label() { return t("costTrendCard.forecast_over_budget"); } },
  exceeded: { tone: "error", get label() { return t("costTrendCard.exceeded"); } },
  early: { tone: "neutral", get label() { return t("costTrendCard.too_early_to_project"); } },
  no_budget: { tone: "neutral", get label() { return t("costTrendCard.no_budget_set"); } },
};
const state = computed(() => STATES[trend.value.state]);
const summary = computed(() => {
  const t = trend.value;
  if (t.state === "exceeded") return tr("costTrendCard.spent_spent_of_budget_the_budget", { spent: usd(t.spentUsd), budget: usd(t.monthlyUsd) });
  if (t.state === "forecast") return tr("costTrendCard.at_this_pace_the_month_ends", { projected: usd(t.projectedUsd), over: usd(t.overUsd), crossing: t.crossLabel ? tr("costTrendCard.crossing_it_around_when", { when: t.crossLabel }) : "" });
  if (t.state === "early") return tr("costTrendCard.the_projection_starts_after_three_days");
  if (t.state === "no_budget") return tr("costTrendCard.at_this_pace_the_month_ends2", { projected: usd(t.projectedUsd) });
  return tr("costTrendCard.at_this_pace_the_month_ends3", { projected: usd(t.projectedUsd), budget: usd(t.monthlyUsd) });
});
const chartLabel = computed(() =>
  tr("costTrendCard.cumulative_spend_this_month_spent_so", {
    spent: usd(trend.value.spentUsd),
    projected: trend.value.projectedUsd === null ? "" : tr("costTrendCard.projected_amount_at_month_end", { amount: usd(trend.value.projectedUsd) }),
    budget: budgetOf.value === null ? tr("costTrendCard.with_no_budget_set") : tr("costTrendCard.against_a_amount_budget", { amount: usd(budgetOf.value) }),
  }),
);

// ---- en qué se va: el mismo reparto que Overview › Breakdown, del día 1 a hoy
type Group = BreakdownResponse["groupBy"];
const GROUPS = [
  { value: "user", get label() { return t("costTrendCard.user"); }, testid: "cost-group-user" },
  { value: "prompt_version", get label() { return t("costTrendCard.prompt_version"); }, testid: "cost-group-prompt_version" },
  { value: "environment", get label() { return t("costTrendCard.environment"); }, testid: "cost-group-environment" },
];
const groupBy = ref<Group>("user");
const setGroup = (g: unknown) => { if (GROUPS.some((o) => o.value === g)) groupBy.value = g as Group; };
const split = useAsync((signal) => api.getBreakdown({ from: new Date(`${props.cost.month.slice(0, 10)}T00:00:00Z`).toISOString(), to: props.now.toISOString(), groupBy: groupBy.value }, signal));
watch(groupBy, () => void split.run(), { immediate: true });
const SHOWN = 4;
const rows = computed(() => {
  const items = (split.data.value?.items ?? []).map((i) => ({ name: i.key, cost: i.costUsd ?? 0 })).filter((i) => i.cost > 0).sort((a, b) => b.cost - a.cost);
  const total = items.reduce((s, i) => s + i.cost, 0);
  const head = items.slice(0, SHOWN);
  const rest = items.slice(SHOWN);
  const all = rest.length ? [...head, { name: tp("costTrendCard.other", rest.length), cost: rest.reduce((s, i) => s + i.cost, 0), other: true }] : head;
  const top = Math.max(0, ...all.map((r) => r.cost));
  return all.map((r) => ({ ...r, other: "other" in r, share: total > 0 ? Math.round((r.cost / total) * 100) : 0, width: top > 0 ? Math.max(2, Math.round((r.cost / top) * 100)) : 0 }));
});
const EMPTY: Record<Group, string> = lazyMessages({
  user: "costTrendCard.users_show_up_when_the_agent",
  prompt_version: "costTrendCard.versions_show_up_when_the_agent",
  environment: "costTrendCard.environments_show_up_when_the_agent",
});
const openBreakdown = () => router.push({ name: "overview-breakdown", params: { experimentId: route.params.experimentId as string }, query: { groupBy: groupBy.value } });
const groupLabel = computed(() => GROUPS.find((g) => g.value === groupBy.value)!.label);
</script>

<template>
  <div class="cost-row" data-testid="cost-trend">
    <Card as="section" gap="sm" class="trend" :aria-label="t('costTrendCard.spend_this_month')">
      <div class="head">
        <h2>{{ t("costTrendCard.spend_this_month") }}</h2>
        <span class="note">{{ t("costTrendCard.month_1_days_estimate_from_the", { month: trend.monthLabel, days: trend.daysInMonth }) }}</span>
        <span class="spacer" />
        <Pill :tone="state.tone" dot data-testid="cost-state">{{ state.label }}</Pill>
      </div>

      <div class="stats">
        <div class="stat"><span class="label">{{ t("costTrendCard.spent_day_day_of_days", { day: Math.ceil(trend.elapsedDays), days: trend.daysInMonth }) }}</span><strong data-testid="cost-spent">{{ usd(trend.spentUsd) }}</strong></div>
        <div class="stat" :class="trend.state"><span class="label">{{ t("costTrendCard.projected_at_month_end") }}</span><strong data-testid="cost-projected">{{ trend.projectedUsd === null ? "–" : usd(trend.projectedUsd) }}</strong></div>
        <div class="stat"><span class="label">{{ t("costTrendCard.budget") }}</span><strong v-if="budgetOf !== null">{{ usd(budgetOf) }}</strong><strong v-else class="none">{{ t("costTrendCard.none") }}</strong><a v-if="budgetOf === null && canSetBudget" class="link" data-testid="cost-set-budget" @click="$emit('setBudget')">{{ t("costTrendCard.set_a_budget") }}</a></div>
      </div>
      <p class="summary" data-testid="cost-summary">{{ summary }}</p>

      <svg :viewBox="`0 0 ${W} ${H}`" width="100%" role="img" :aria-label="chartLabel" class="chart">
        <g v-for="t in ticks" :key="t.y">
          <line :x1="LEFT" :y1="t.y" :x2="RIGHT" :y2="t.y" class="grid" />
          <text :x="LEFT - 6" :y="t.y + 3.5" text-anchor="end" class="axis">{{ t.label }}</text>
        </g>
        <rect v-for="b in bars" :key="b.key" :x="b.x" :y="b.y" width="14" :height="b.h" rx="2" class="bar" />
        <rect v-if="trend.projection.length" :x="today.x" :y="TOP" :width="RIGHT - today.x" :height="BOTTOM - TOP" class="future" />
        <template v-if="budgetOf !== null">
          <line :x1="LEFT" :y1="Y(budgetOf)" :x2="RIGHT" :y2="Y(budgetOf)" class="budget" />
          <text :x="LEFT + 6" :y="Y(budgetOf) - 6" class="budget-label">{{ t("costTrendCard.budget_amount", { amount: usd(budgetOf) }) }}</text>
        </template>
        <polyline v-if="trend.projection.length" :points="points(trend.projection)" class="projection" />
        <polyline :points="points(trend.spent)" class="spent" />
        <template v-if="trend.projection.length">
          <line :x1="today.x" :y1="TOP" :x2="today.x" :y2="BOTTOM" class="today-line" />
          <text :x="today.x + 6" :y="TOP + 14" class="today-label">{{ t("costTrendCard.today") }}</text>
        </template>
        <circle :cx="today.x" :cy="today.y" r="4.5" class="today-dot" />
        <template v-if="end">
          <circle :cx="end.x" :cy="end.y" r="5" class="end-dot" />
          <text :x="end.x - 10" :y="end.y - 12" text-anchor="end" class="end-label">{{ t("costTrendCard.amount_projected", { amount: usd(trend.projectedUsd) }) }}</text>
        </template>
        <circle v-if="cross !== null && budgetOf !== null" :cx="cross" :cy="Y(budgetOf)" r="4" class="cross-dot" />
        <text v-for="x in xLabels" :key="x.label" :x="x.x" :y="H - 8" text-anchor="middle" class="axis">{{ x.label }}</text>
      </svg>
      <div class="legend" aria-hidden="true">
        <span><i class="key spent-key" />{{ t("costTrendCard.spent") }}</span><span><i class="key proj-key" />{{ t("costTrendCard.projected") }}</span><span v-if="budgetOf !== null"><i class="key budget-key" />{{ t("costTrendCard.budget2") }}</span><span><i class="key bar-key" />{{ t("costTrendCard.per_day") }}</span>
      </div>
    </Card>

    <Card as="section" gap="sm" class="split" :aria-label="t('costTrendCard.where_it_goes')">
      <div class="head"><h2>{{ t("costTrendCard.where_it_goes") }}</h2></div>
      <SegmentedControl :options="GROUPS" :model-value="groupBy" :aria-label="t('costTrendCard.group_the_spend_by')" data-testid="cost-group" @update:model-value="setGroup" />
      <div class="rows">
        <div v-for="r in rows" :key="r.name" class="item" data-testid="cost-split-row">
          <div class="line"><span class="name" :class="{ muted: r.other }">{{ r.name }}</span><span class="val">{{ usd(r.cost) }} <span class="share">· {{ r.share }}%</span></span></div>
          <div class="track"><div class="fill" :class="{ other: r.other }" :style="{ width: `${r.width}%` }" /></div>
        </div>
        <p v-if="!rows.length && !split.loading.value" class="empty" data-testid="cost-split-empty">{{ EMPTY[groupBy] }}</p>
      </div>
      <a class="link" data-testid="cost-open-breakdown" @click="openBreakdown">{{ t("costTrendCard.open_breakdown_group", { group: groupLabel }) }}</a>
    </Card>
  </div>
</template>

<style scoped>
.cost-row { display: grid; grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); gap: 12px; }
@media (max-width: 1100px) { .cost-row { grid-template-columns: minmax(0, 1fr); } }
.head { display: flex; align-items: center; gap: 12px; }
.head h2 { margin: 0; font-size: 14px; font-weight: 800; }
.note { font-size: 11.5px; color: var(--mt-muted); }
.spacer { flex: 1; }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.stat { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: var(--mt-radius-sm); background: var(--mt-soft-2); }
.stat .label { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--mt-muted); }
.stat strong { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
.stat strong.none { color: var(--mt-muted); }
.stat .link { font-size: 12px; }
.stat.forecast { background: var(--mt-warn-bg); }
.stat.forecast .label, .stat.forecast strong { color: var(--mt-warn-ink); }
.stat.exceeded { background: var(--mt-err-bg); }
.stat.exceeded .label, .stat.exceeded strong { color: var(--mt-err-ink); }
.summary { margin: 0; font-size: 12.5px; color: var(--mt-muted); }
.chart { display: block; }
.grid { stroke: var(--mt-line-2); stroke-width: 1; }
.axis { font: 400 10.5px var(--mt-mono); fill: var(--mt-muted); }
.bar { fill: var(--mt-accent-soft); }
.future { fill: var(--mt-soft-2); opacity: 0.55; }
.budget { stroke: var(--mt-err); stroke-width: 1.6; stroke-dasharray: 6 4; }
.budget-label { font: 700 11px var(--mt-sans); fill: var(--mt-err-ink); }
.spent { fill: none; stroke: var(--mt-accent); stroke-width: 2.6; stroke-linejoin: round; stroke-linecap: round; }
.projection { fill: none; stroke: var(--mt-warn); stroke-width: 2.6; stroke-dasharray: 2 5; stroke-linecap: round; }
.today-line { stroke: var(--mt-muted); stroke-width: 1; stroke-dasharray: 3 3; }
.today-label { font: 700 11px var(--mt-sans); fill: var(--mt-muted); }
.today-dot { fill: var(--mt-accent); stroke: var(--mt-card); stroke-width: 2; }
.end-dot { fill: var(--mt-warn); stroke: var(--mt-card); stroke-width: 2; }
.end-label { font: 800 11.5px var(--mt-sans); fill: var(--mt-warn-ink); }
.cross-dot { fill: var(--mt-card); stroke: var(--mt-err); stroke-width: 2; }
.legend { display: flex; gap: 14px; font-size: 11.5px; color: var(--mt-muted); }
.legend span { display: flex; align-items: center; gap: 5px; }
.key { display: inline-block; width: 14px; height: 0; border-top: 3px solid; }
.spent-key { border-color: var(--mt-accent); }
.proj-key { border-top-style: dotted; border-color: var(--mt-warn); }
.budget-key { border-top-width: 2px; border-top-style: dashed; border-color: var(--mt-err); }
.bar-key { height: 9px; width: 9px; border: 0; border-radius: 2px; background: var(--mt-accent-soft); }

.split { min-height: 0; }
.rows { display: flex; flex-direction: column; flex: 1; }
.item { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-top: 1px solid var(--mt-line-2); }
.line { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.name { font: 500 12px var(--mt-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name.muted { color: var(--mt-muted); }
.val { font: 500 12px var(--mt-mono); white-space: nowrap; }
.share { color: var(--mt-muted); font-weight: 400; }
.track { height: 6px; border-radius: 3px; background: var(--mt-line-2); }
.fill { height: 6px; border-radius: 3px; background: var(--mt-accent); }
.fill.other { background: var(--mt-muted); }
.empty { margin: 0; padding: 12px 0; font-size: 12.5px; color: var(--mt-muted); border-top: 1px solid var(--mt-line-2); }
.link { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); cursor: pointer; }
</style>
