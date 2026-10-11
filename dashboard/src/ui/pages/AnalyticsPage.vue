<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../components/Button.vue";
import Card from "../components/Card.vue";
import Checkbox from "../components/Checkbox.vue";
import DataTable from "../components/DataTable.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import Pill from "../components/Pill.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";
import { analyticsCsv, compareAnalytics, findInsight, MIN_TRACES, sparkPath, trendRates, type AnalyticsGroup, type AnalyticsItem } from "@/domain/analytics";
import { formatCostUsd, formatCount, formatDuration, formatPercent } from "@/domain/format";

/**
 * Overview › Analytics: todas las versiones de prompt (o todos los entornos) del agente en una sola tabla, para decidir qué
 * promocionar sin ir prompt a prompt. Cada tasa de error lleva su margen del 95 %: si dos márgenes se solapan, la diferencia
 * puede ser ruido. Al marcar dos filas aparece lo que cambia de una a otra. Un entorno corre otra versión a propósito.
 */
const route = useRoute();
const router = useRouter();
const f = useFilters();
const api = useTraceApi();

const GROUPS: { id: AnalyticsGroup | "user"; label: string; soon?: boolean }[] = [
  { id: "prompt_version", label: "Prompt version" },
  { id: "environment", label: "Environment" },
  { id: "user", label: "User", soon: true },
];

const groupBy = computed<AnalyticsGroup>(() => (route.query.groupBy === "environment" ? "environment" : "prompt_version"));
function setGroup(id: AnalyticsGroup | "user") {
  if (id === "user") return;
  selected.value = [];
  void router.replace({ query: { ...route.query, groupBy: id } });
}

const analytics = useAsync((signal) => api.getAnalytics({ ...f.resolve(), groupBy: groupBy.value }, signal));
watch([() => f.rangeSig.value, groupBy], () => void analytics.run(), { immediate: true });

const items = computed<AnalyticsItem[]>(() => analytics.data.value?.items ?? []);
const insight = computed(() => findInsight(items.value));
const relatedLabel = computed(() => (groupBy.value === "environment" ? "Prompt versions" : "Seen in"));
const nameLabel = computed(() => (groupBy.value === "environment" ? "Environment" : "Prompt version"));

// las filas marcadas, la más antigua primero: la comparación va de la primera a la segunda
const selected = ref<string[]>([]);
function toggle(key: string) {
  selected.value = selected.value.includes(key) ? selected.value.filter((k) => k !== key) : [...selected.value, key].slice(-2);
}
const compared = computed(() => {
  const [a, b] = selected.value.map((k) => items.value.find((i) => i.key === k));
  return a && b ? { a, b, cells: compareAnalytics(a, b) } : null;
});
watch(items, (list) => {
  selected.value = selected.value.filter((k) => list.some((i) => i.key === k));
});

const sparkMax = computed(() => Math.max(0.05, ...items.value.flatMap((i) => trendRates(i))));
const spark = (i: AnalyticsItem) => sparkPath(trendRates(i), sparkMax.value, 110, 26);
const isBad = (i: AnalyticsItem) => i.traces >= MIN_TRACES && i.errorRate >= 0.05;
const few = (i: AnalyticsItem) => i.traces < MIN_TRACES;
const errorText = (i: AnalyticsItem) => formatPercent(i.errorRate);
const marginText = (i: AnalyticsItem) => `±${(i.errorMargin * 100).toFixed(1)}`;

const emptyHint = computed(() =>
  groupBy.value === "environment"
    ? "Environments show up when the agent sets one in its SDK configuration (environment=…)."
    : "Versions show up when the agent reads its prompt with memtrace.prompts.",
);

function exportCsv() {
  const blob = new Blob([analyticsCsv(groupBy.value, items.value)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics-${groupBy.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
const chartsRoute = computed(() => ({ name: "overview-charts", params: route.params }));
</script>

<template>
  <div class="page" data-testid="analytics-page">
    <PageHeader :crumbs="[{ label: 'Overview' }, { label: 'Analytics' }]" icon="M3 3v18h18M7 14l4-4 3 3 5-6" title="Analytics">
      <div class="actions">
        <Button variant="link" :to="chartsRoute" data-testid="open-charts">Open in Custom charts →</Button>
        <Button variant="secondary" :disabled="items.length === 0" data-testid="export-csv" @click="exportCsv">Export CSV</Button>
      </div>
    </PageHeader>

    <div class="toolbar">
      <span class="label">Group by</span>
      <div class="seg" role="group" aria-label="Group by">
        <Button
          v-for="g in GROUPS"
          :key="g.id"
          :variant="g.id === groupBy ? 'primary' : 'secondary'"
          :disabled="g.soon"
          :aria-pressed="g.id === groupBy"
          :data-testid="`group-${g.id}`"
          @click="setGroup(g.id)"
        >
          {{ g.label }}<Pill v-if="g.soon" tone="highlight">Soon</Pill>
        </Button>
      </div>
    </div>

    <ErrorBanner v-if="analytics.error.value" :error="analytics.error.value" @retry="analytics.run()" />
    <LoadingState v-else-if="analytics.loading.value && !analytics.data.value" size="lg" />
    <EmptyState v-else-if="items.length === 0" icon="bar_chart" title="Nothing to analyse yet" data-testid="analytics-empty">
      No traces in this range. {{ emptyHint }}
    </EmptyState>

    <template v-else>
      <section v-if="insight" class="insight" data-testid="analytics-insight">
        <span class="insight-dot" aria-hidden="true">!</span>
        <span class="insight-text">
          <strong>{{ insight.worst.key }} fails {{ errorText(insight.worst) }} of the time</strong>
          against {{ errorText(insight.best) }} in {{ insight.best.key }}.
          <span class="muted">Their ranges do not overlap, so the difference is reliable.</span>
        </span>
      </section>
      <section v-if="analytics.data.value && analytics.data.value.unpricedTokens > 0" class="note" data-testid="analytics-unpriced">
        {{ formatCount(analytics.data.value.unpricedTokens) }} tokens use a model with no price, so costs marked ≥ are a minimum.
        <router-link :to="{ name: 'model-pricing' }">See model pricing →</router-link>
      </section>

      <Card padding="none" block class="table-card">
        <DataTable class="analytics" sticky nowrap>
          <thead>
            <tr>
              <th class="pick"><span class="sr-only">Compare</span></th>
              <th>{{ nameLabel }}</th>
              <th>{{ relatedLabel }}</th>
              <th class="num">Traces</th>
              <th class="num">Errors (±95 %)</th>
              <th class="num">p95</th>
              <th class="num">Cost / trace</th>
              <th class="num">Total cost</th>
              <th>Errors, 7 days</th>
              <th class="num">👍 rate</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in items" :key="i.key" :class="{ on: selected.includes(i.key), few: few(i) }" :data-testid="`row-${i.key}`">
              <td class="pick">
                <Checkbox :model-value="selected.includes(i.key)" :aria-label="`Compare ${i.key}`" :data-testid="`pick-${i.key}`" @change="toggle(i.key)" />
              </td>
              <td class="name">
                <span class="key">{{ i.key }}</span>
                <Pill v-if="few(i)" tone="warn">few traces</Pill>
              </td>
              <td>
                <span class="chips">
                  <Pill v-for="r in i.related" :key="r" tone="info">{{ r }}</Pill>
                  <span v-if="i.related.length === 0" class="muted">–</span>
                </span>
              </td>
              <td class="num">{{ formatCount(i.traces) }}</td>
              <td class="num">
                <span class="err" :class="{ bad: isBad(i) }">{{ errorText(i) }}</span> <span class="margin mono">{{ marginText(i) }}</span>
              </td>
              <td class="num muted">{{ i.p95Ms === null ? "–" : formatDuration(i.p95Ms) }}</td>
              <td class="num">{{ formatCostUsd(i.costPerTraceUsd) ?? "–" }}</td>
              <td class="num muted">{{ i.costUsd === null ? "–" : `${i.costComplete ? "" : "≥ "}${formatCostUsd(i.costUsd)}` }}</td>
              <td>
                <svg class="spark" width="110" height="26" viewBox="0 0 110 26" role="img" :aria-label="`Error rate over the last 7 days for ${i.key}`">
                  <path :d="spark(i)" fill="none" :stroke="isBad(i) ? 'var(--mt-err-ink)' : 'var(--mt-accent)'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                </svg>
              </td>
              <td class="num muted">{{ i.thumbsUpRate === null ? "–" : formatPercent(i.thumbsUpRate) }}</td>
            </tr>
          </tbody>
        </DataTable>
        <p class="foot muted">
          Tick two rows to compare them. The ± is the 95 % margin: when two ranges overlap, the difference may be noise. Rows with fewer than
          {{ MIN_TRACES }} traces are dimmed.
        </p>
      </Card>

      <Card v-if="compared" block class="compare" data-testid="analytics-compare">
        <div class="compare-head">
          <strong>{{ compared.a.key }}</strong><span class="muted">against</span><strong>{{ compared.b.key }}</strong>
          <Pill v-if="compared.a.related.join() !== compared.b.related.join()" tone="info" data-testid="compare-differs">
            {{ groupBy === "environment" ? "Run different versions" : "Seen in different environments" }}
          </Pill>
          <Button variant="link" class="clear" @click="selected = []">Clear</Button>
        </div>
        <div class="cells">
          <div v-for="c in compared.cells" :key="c.label" class="cell" :data-testid="`delta-${c.label}`">
            <span class="cell-label">{{ c.label }}</span>
            <span class="cell-range muted">{{ c.from }} → <strong>{{ c.to }}</strong></span>
            <span class="cell-delta" :class="c.tone">{{ c.delta }}</span>
            <span class="cell-note muted">{{ c.note }}</span>
          </div>
        </div>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
  overflow: auto;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.muted {
  color: var(--mt-muted);
}
.mono {
  font-family: var(--mt-mono);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.seg {
  display: inline-flex;
  gap: 6px;
}

.insight {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--mt-radius, 10px);
  border: 1px solid var(--mt-err-ink);
  background: var(--mt-err-bg);
}
.insight-dot {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--mt-err-ink);
  color: var(--mt-surface);
  font-weight: 800;
}
.insight-text {
  flex: 1;
}
.note {
  padding: 10px 14px;
  border-radius: var(--mt-radius, 10px);
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
  font-size: 12.5px;
}
.note a {
  margin-left: 6px;
  font-weight: 700;
  color: var(--mt-accent-text);
}

.table-card {
  overflow: auto;
  padding: 0;
}
.pick {
  width: 36px;
}
th.num,
td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
tr.few td {
  opacity: 0.6;
}
tr.few td.pick {
  opacity: 1;
}
tr.on {
  background: var(--mt-accent-soft);
}
.name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.key {
  font-weight: 800;
}
.chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.err {
  font-weight: 800;
}
.err.bad {
  color: var(--mt-err-ink);
}
.margin {
  font-size: 11px;
  color: var(--mt-faint);
}
.spark {
  display: block;
}
.foot {
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--mt-line-2);
  background: var(--mt-soft);
  font-size: 12.5px;
}

.compare {
  border: 2px solid var(--mt-accent);
}
.compare-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.clear {
  margin-left: auto;
}
.cells {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-radius: var(--mt-radius-sm, 8px);
  background: var(--mt-soft);
}
.cell-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--mt-muted);
}
.cell-range,
.cell-note {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cell-delta {
  font-size: 18px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.cell-delta.ok {
  color: var(--mt-ok-ink);
}
.cell-delta.error {
  color: var(--mt-err-ink);
}
@media (max-width: 900px) {
  .cells {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
