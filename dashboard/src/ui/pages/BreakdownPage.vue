<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "../components/Button.vue";
import Card from "../components/Card.vue";
import DataTable from "../components/DataTable.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import Pill from "../components/Pill.vue";
import SegmentedControl from "../components/SegmentedControl.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";
import { breakdownCsv, compareBreakdown, findInsight, MIN_TRACES, sparkPath, trendRates, type BreakdownGroup, type BreakdownItem } from "@/domain/breakdown";
import { formatCostUsd, formatCount, formatDuration, formatPercent } from "@/domain/format";

/**
 * Overview › Breakdown: todas las versiones de prompt (o todos los entornos) del agente en una sola tabla, para decidir qué
 * promocionar sin ir prompt a prompt. Cada tasa de error lleva su margen del 95 %: si dos márgenes se solapan, la diferencia
 * puede ser ruido. Se compara siempre de dos en dos: A (la base) contra B (la candidata). Dos huecos encima de la tabla dicen qué
 * falta por elegir y un clic en una fila rellena el siguiente hueco libre. Un entorno corre otra versión a propósito.
 */
const route = useRoute();
const router = useRouter();
const f = useFilters();
const api = useTraceApi();

const GROUPS = [
  { value: "prompt_version", label: "Prompt version", testid: "tab-prompt_version" },
  { value: "environment", label: "Environment", testid: "tab-environment" },
  // llega con el atributo de usuario final del SDK
  { value: "user", label: "User", count: "Soon", disabled: true, testid: "tab-user" },
];

const groupBy = computed<BreakdownGroup>(() => (route.query.groupBy === "environment" ? "environment" : "prompt_version"));
function setGroup(id: unknown) {
  if (id !== "prompt_version" && id !== "environment") return;
  void router.replace({ query: { ...route.query, groupBy: id } });
}

const breakdown = useAsync((signal) => api.getBreakdown({ ...f.resolve(), groupBy: groupBy.value }, signal));
watch([() => f.rangeSig.value, groupBy], () => void breakdown.run(), { immediate: true });

const items = computed<BreakdownItem[]>(() => breakdown.data.value?.items ?? []);
const insight = computed(() => findInsight(items.value));
const relatedLabel = computed(() => (groupBy.value === "environment" ? "Prompt versions" : "Runs in"));
const nameLabel = computed(() => (groupBy.value === "environment" ? "Environment" : "Prompt version"));
const noun = computed(() => (groupBy.value === "environment" ? "environment" : "version"));

// A es la base y B la candidata: la comparación va de A a B. Con una sola fila no hay nada que elegir, esa fila es A.
const keyA = ref<string | null>(null);
const keyB = ref<string | null>(null);
const only = computed(() => (items.value.length === 1 ? items.value[0]! : null));
const byKey = (k: string | null) => (k ? items.value.find((i) => i.key === k) ?? null : null);
const itemA = computed(() => only.value ?? byKey(keyA.value));
const itemB = computed(() => (only.value ? null : byKey(keyB.value)));
function pick(key: string) {
  if (only.value) return;
  if (keyA.value === key) keyA.value = null;
  else if (keyB.value === key) keyB.value = null;
  else if (!keyA.value) keyA.value = key;
  else keyB.value = key;
}
const letterOf = (key: string) => (only.value?.key === key || keyA.value === key ? "A" : keyB.value === key ? "B" : "");
/** La letra que recibiría una fila sin elegir: la de su próximo hueco libre. */
const nextLetter = computed(() => (keyA.value ? "B" : "A"));
function clear() {
  keyA.value = null;
  keyB.value = null;
}
function compareInsight() {
  if (!insight.value) return;
  keyA.value = insight.value.best.key;
  keyB.value = insight.value.worst.key;
}
watch([items, groupBy], () => {
  if (!byKey(keyA.value)) keyA.value = null;
  if (!byKey(keyB.value)) keyB.value = null;
});
watch(groupBy, clear);

const compared = computed(() => (itemA.value && itemB.value ? { a: itemA.value, b: itemB.value, cells: compareBreakdown(itemA.value, itemB.value) } : null));
const PLACEHOLDER_CELLS = ["ERRORS", "P95 LATENCY", "COST PER TRACE", "👍 RATE"];

const slotSummary = (i: BreakdownItem) => `${i.related.length ? `${i.related.join(", ")} · ` : ""}${formatCount(i.traces)} traces · ${formatPercent(i.errorRate)} errors`;
const slots = computed(() => [
  {
    letter: "A",
    role: "Baseline",
    item: itemA.value,
    empty: "Click a row to set the baseline",
    next: !itemA.value,
  },
  {
    letter: "B",
    role: "Candidate",
    item: itemB.value,
    empty: only.value ? `No second ${noun.value} yet` : itemA.value ? `Now click another row to set the candidate` : "Then click a second row",
    next: !!itemA.value && !itemB.value && !only.value,
  },
]);
const hint = computed(() => {
  if (only.value) return `You need a second ${noun.value} to compare.`;
  if (compared.value) return `Showing what changes from A to B.`;
  if (itemA.value) return "Now pick the candidate (B).";
  return "Pick two rows: first the baseline (A), then the candidate (B).";
});

const sparkMax = computed(() => Math.max(0.05, ...items.value.flatMap((i) => trendRates(i))));
const spark = (i: BreakdownItem) => sparkPath(trendRates(i), sparkMax.value, 110, 26);
const isBad = (i: BreakdownItem) => i.traces >= MIN_TRACES && i.errorRate >= 0.05;
const few = (i: BreakdownItem) => i.traces < MIN_TRACES;
const errorText = (i: BreakdownItem) => formatPercent(i.errorRate);
const marginText = (i: BreakdownItem) => `±${(i.errorMargin * 100).toFixed(1)}`;

const emptyHint = computed(() =>
  groupBy.value === "environment"
    ? "Environments show up when the agent sets one in its SDK configuration (environment=…)."
    : "Versions show up when the agent reads its prompt with memtrace.prompts.",
);

function exportCsv() {
  const blob = new Blob([breakdownCsv(groupBy.value, items.value)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `breakdown-${groupBy.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
const chartsRoute = computed(() => ({ name: "overview-charts", params: route.params }));
</script>

<template>
  <div class="page" data-testid="breakdown-page">
    <PageHeader :crumbs="[{ label: 'Overview' }, { label: 'Breakdown' }]" icon="M3 3v18h18M7 14l4-4 3 3 5-6" title="Breakdown">
      <div class="actions">
        <Button variant="link" :to="chartsRoute" data-testid="open-charts">Open in Custom charts →</Button>
        <Button variant="secondary" :disabled="items.length === 0" data-testid="export-csv" @click="exportCsv">Export CSV</Button>
      </div>
    </PageHeader>

    <ErrorBanner v-if="breakdown.error.value" :error="breakdown.error.value" @retry="breakdown.run()" />
    <LoadingState v-else-if="breakdown.loading.value && !breakdown.data.value" size="lg" />

    <Card v-else padding="none" block class="main-card">
      <header class="head">
        <div class="head-text">
          <h2>Compare {{ noun }}s</h2>
          <p class="muted">Always two at a time: a baseline (A) against a candidate (B).</p>
        </div>
        <span class="group-label">GROUP BY</span>
        <SegmentedControl :options="GROUPS" :model-value="groupBy" aria-label="Group by" data-testid="group-tabs" @update:model-value="setGroup" />
      </header>

      <EmptyState v-if="items.length === 0" icon="bar_chart" title="Nothing to analyse yet" data-testid="breakdown-empty">
        No traces in this range. {{ emptyHint }}
      </EmptyState>

      <template v-else>
        <div v-if="breakdown.data.value && breakdown.data.value.unpricedTokens > 0" class="note" data-testid="breakdown-unpriced">
          {{ formatCount(breakdown.data.value.unpricedTokens) }} tokens use a model with no price, so costs marked ≥ are a minimum.
          <router-link :to="{ name: 'model-pricing' }">See model pricing →</router-link>
        </div>

        <div v-if="insight && !only" class="insight" data-testid="breakdown-insight">
          <span class="insight-dot" aria-hidden="true">!</span>
          <span class="insight-text">
            <strong>{{ insight.worst.key }} fails {{ errorText(insight.worst) }} of the time</strong>
            against {{ errorText(insight.best) }} in {{ insight.best.key }}.
            <span class="muted">Their ranges do not overlap, so the difference is reliable.</span>
          </span>
          <Button variant="secondary" size="sm" data-testid="insight-compare" @click="compareInsight">Compare with {{ insight.best.key }} →</Button>
        </div>

        <div class="pair" data-testid="breakdown-pair">
          <div v-for="s in slots" :key="s.letter" class="slot" :class="{ filled: !!s.item, next: s.next }" :data-testid="`slot-${s.letter}`">
            <span class="letter" aria-hidden="true">{{ s.letter }}</span>
            <div class="slot-body">
              <span class="slot-role">{{ s.letter }} · {{ s.role.toUpperCase() }}</span>
              <template v-if="s.item">
                <strong class="slot-title">{{ s.item.key }}</strong>
                <span class="muted slot-sub">{{ slotSummary(s.item) }}</span>
              </template>
              <span v-else class="slot-empty">{{ s.empty }}</span>
            </div>
          </div>
          <div class="pair-side">
            <span class="pair-hint" data-testid="pair-hint">{{ hint }}</span>
            <Button v-if="!only && (keyA || keyB)" variant="link" size="sm" data-testid="clear-pair" @click="clear">Clear</Button>
          </div>
        </div>

        <DataTable class="breakdown" sticky nowrap bare>
          <thead>
            <tr>
              <th class="pick">Set</th>
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
            <tr
              v-for="i in items"
              :key="i.key"
              :class="{ on: !!letterOf(i.key), few: few(i), pickable: !only }"
              :data-testid="`row-${i.key}`"
              @click="pick(i.key)"
            >
              <td class="pick">
                <Button
                  variant="icon"
                  size="sm"
                  class="pick-btn"
                  :class="{ set: !!letterOf(i.key), a: letterOf(i.key) === 'A', b: letterOf(i.key) === 'B' }"
                  :disabled="!!only"
                  :aria-pressed="!!letterOf(i.key)"
                  :aria-label="letterOf(i.key) ? `${i.key} is ${letterOf(i.key)}. Click to clear it` : `Set ${i.key} as ${nextLetter}`"
                  :title="letterOf(i.key) ? 'Click to clear' : `Set as ${nextLetter}`"
                  :data-testid="`pick-${i.key}`"
                  @click.stop="pick(i.key)"
                >
                  <span aria-hidden="true">{{ letterOf(i.key) || nextLetter }}</span>
                </Button>
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
          The ± is the 95 % margin: when two ranges overlap, the difference may be noise. Rows with fewer than {{ MIN_TRACES }} traces are dimmed.
        </p>

        <section v-if="only" class="guide" data-testid="breakdown-guide">
          <div class="guide-text">
            <strong>You need a second {{ noun }} to compare</strong>
            <span class="muted">
              <template v-if="groupBy === 'environment'">Run the agent in another environment (environment=… in its SDK configuration) and it will show up here as candidate B.</template>
              <template v-else>Publish a new version of the prompt and it will show up here as candidate B. Until then there is nothing to compare.</template>
            </span>
          </div>
          <Button v-if="groupBy === 'prompt_version'" variant="primary" :to="{ name: 'prompts' }" data-testid="guide-prompts">Open Prompts</Button>
        </section>

        <section v-else-if="compared" class="compare" data-testid="breakdown-compare">
          <div class="compare-head">
            <span class="tag a">A</span><strong>{{ compared.a.key }}</strong><span class="muted">against</span><span class="tag b">B</span><strong>{{ compared.b.key }}</strong>
            <Pill v-if="compared.a.related.join() !== compared.b.related.join()" tone="info" data-testid="compare-differs">
              {{ groupBy === "environment" ? "Run different versions" : "Seen in different environments" }}
            </Pill>
          </div>
          <div class="cells">
            <div v-for="c in compared.cells" :key="c.label" class="cell" :data-testid="`delta-${c.label}`">
              <span class="cell-label">{{ c.label }}</span>
              <span class="cell-range muted">{{ c.from }} → <strong>{{ c.to }}</strong></span>
              <span class="cell-delta" :class="c.tone">{{ c.delta }}</span>
              <span class="cell-note muted">{{ c.note }}</span>
            </div>
          </div>
        </section>

        <section v-else class="compare idle" data-testid="breakdown-compare-empty">
          <span class="compare-title">What changes between the two {{ noun }}s</span>
          <div class="cells">
            <div v-for="l in PLACEHOLDER_CELLS" :key="l" class="cell ghost">
              <span class="cell-label">{{ l }}</span>
              <span class="cell-delta muted">–</span>
            </div>
          </div>
          <span class="muted compare-note">Pick A and B above and the numbers appear here.</span>
        </section>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 24px 24px;
  background: var(--mt-soft-2);
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

.main-card {
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px 16px;
}
.head-text {
  flex: 1;
  min-width: 0;
}
.head h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.head p {
  margin: 0;
}
.group-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mt-muted);
}

.insight {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 24px 16px;
  padding: 12px 16px;
  border-radius: var(--mt-radius-lg);
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
  margin: 0 24px 16px;
  padding: 10px 14px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
  font-size: 12.5px;
}
.note a {
  margin-left: 6px;
  font-weight: 700;
  color: var(--mt-accent-text);
}

/* los dos huecos: lo que falta por elegir se ve antes que la tabla */
.pair {
  display: flex;
  align-items: stretch;
  gap: 12px;
  margin: 0 24px 20px;
  padding: 14px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
}
.slot {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--mt-radius-lg);
  border: 1.5px dashed var(--mt-line);
  background: var(--mt-card);
}
.slot.next {
  border-color: var(--mt-accent);
  box-shadow: 0 0 0 3px var(--mt-accent-soft);
}
.slot.filled {
  border-style: solid;
  border-color: var(--mt-accent);
}
.letter {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  border: 1.5px dashed var(--mt-faint);
  color: var(--mt-faint);
}
.slot.filled .letter,
.slot.next .letter {
  border: 1.5px solid var(--mt-accent);
  color: var(--mt-accent-text);
}
.slot.filled .letter {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.slot-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.slot-role {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--mt-muted);
}
.slot-title {
  font-size: 14px;
}
.slot-sub {
  font-size: 12px;
}
.slot-empty {
  font-weight: 700;
  color: var(--mt-muted);
}
.slot.next .slot-empty {
  color: var(--mt-accent-text);
}
.pair-side {
  flex: none;
  width: 210px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.pair-hint {
  font-size: 12.5px;
  color: var(--mt-muted);
}

th.pick,
td.pick {
  width: 44px;
}
th.num,
td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
tr.pickable {
  cursor: pointer;
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
/* círculo de la fila: punteado con la letra que recibiría; lleno cuando ya es A o B */
.pick-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 50%;
  border: 1.5px dashed var(--mt-faint);
  background: var(--mt-card);
  color: var(--mt-faint);
  font-size: 12px;
  font-weight: 800;
}
.pick-btn.set {
  border-style: solid;
  border-color: var(--mt-accent);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
tr.pickable:hover .pick-btn:not(.set) {
  border-color: var(--mt-accent);
  color: var(--mt-accent-text);
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
  padding: 12px 24px;
  border-top: 1px solid var(--mt-line);
  font-size: 12.5px;
}

.guide {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 8px 24px 24px;
  padding: 20px 22px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-accent-soft);
  background: var(--mt-soft);
}
.guide-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.compare {
  padding: 20px 24px 24px;
  border-top: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
}
.compare-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.compare-title {
  display: block;
  margin-bottom: 12px;
  font-weight: 800;
  font-size: 14px;
}
.compare-note {
  display: block;
  margin-top: 12px;
  font-size: 12.5px;
}
.tag {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
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
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
}
.cell.ghost {
  border-style: dashed;
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
  .head,
  .pair {
    flex-wrap: wrap;
  }
}
</style>
