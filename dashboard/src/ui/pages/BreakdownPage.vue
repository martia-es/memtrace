<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { MessageKey } from "../i18n";
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
import { t } from "../i18n";

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
  { value: "prompt_version", get label() { return t("breakdownPage.prompt_version"); }, testid: "tab-prompt_version" },
  { value: "environment", get label() { return t("breakdownPage.environment"); }, testid: "tab-environment" },
  { value: "user", get label() { return t("breakdownPage.user"); }, testid: "tab-user" },
];

const GROUP_IDS: readonly BreakdownGroup[] = ["prompt_version", "environment", "user"];
const groupBy = computed<BreakdownGroup>(() => GROUP_IDS.find((g) => g === route.query.groupBy) ?? "prompt_version");
function setGroup(id: unknown) {
  const group = GROUP_IDS.find((g) => g === id);
  if (!group) return;
  void router.replace({ query: { ...route.query, groupBy: group } });
}

const breakdown = useAsync((signal) => api.getBreakdown({ ...f.resolve(), groupBy: groupBy.value }, signal));
watch([() => f.rangeSig.value, groupBy], () => void breakdown.run(), { immediate: true });

const items = computed<BreakdownItem[]>(() => breakdown.data.value?.items ?? []);
const insight = computed(() => findInsight(items.value));
const relatedLabel = computed(() => (groupBy.value === "environment" ? t("breakdownPage.prompt_versions") : t("breakdownPage.runs_in")));
const nameLabel = computed(() => ({ prompt_version: t("breakdownPage.prompt_version"), environment: t("breakdownPage.environment"), user: t("breakdownPage.user") })[groupBy.value]);
const noun = computed(() => ({ prompt_version: "version", environment: "environment", user: "user" })[groupBy.value]);
/** Frase por tipo de elemento: el género y el plural cambian según el idioma, así que cada uno lleva su clave. */
const byNoun = (prefix: string) => t(`${prefix}.${noun.value}` as MessageKey);

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
const PLACEHOLDER_CELLS = computed(() => [t("breakdownPage.errors"), t("breakdownPage.p95_latency"), t("breakdownPage.cost_per_trace"), t("breakdownPage.rate2")]);

const slotSummary = (i: BreakdownItem) => `${i.related.length ? `${i.related.join(", ")} · ` : ""}${t("breakdownPage.traces_traces_errors_errors", { traces: formatCount(i.traces), errors: formatPercent(i.errorRate) })}`;
const slots = computed(() => [
  {
    letter: "A",
    role: t("breakdownPage.baseline"),
    item: itemA.value,
    empty: t("breakdownPage.click_a_row_to_set_the"),
    next: !itemA.value,
  },
  {
    letter: "B",
    role: t("breakdownPage.candidate"),
    item: itemB.value,
    empty: only.value ? byNoun("breakdownPage.noSecond") : itemA.value ? t("breakdownPage.now_click_another_row_to_set") : t("breakdownPage.then_click_a_second_row"),
    next: !!itemA.value && !itemB.value && !only.value,
  },
]);
const hint = computed(() => {
  if (only.value) return byNoun("breakdownPage.needSecond") + ".";
  if (compared.value) return t("breakdownPage.showing_what_changes_from_a_to");
  if (itemA.value) return t("breakdownPage.now_pick_the_candidate_b");
  return t("breakdownPage.pick_two_rows_first_the_baseline");
});

const sparkMax = computed(() => Math.max(0.05, ...items.value.flatMap((i) => trendRates(i))));
const spark = (i: BreakdownItem) => sparkPath(trendRates(i), sparkMax.value, 110, 26);
const isBad = (i: BreakdownItem) => i.traces >= MIN_TRACES && i.errorRate >= 0.05;
const few = (i: BreakdownItem) => i.traces < MIN_TRACES;
const errorText = (i: BreakdownItem) => formatPercent(i.errorRate);
const marginText = (i: BreakdownItem) => `±${(i.errorMargin * 100).toFixed(1)}`;

const emptyHint = computed(() =>
  ({
    prompt_version: t("breakdownPage.versions_show_up_when_the_agent"),
    environment: t("breakdownPage.environments_show_up_when_the_agent"),
    user: t("breakdownPage.users_show_up_when_the_agent"),
  })[groupBy.value],
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
    <PageHeader :crumbs="[{ label: t('nav.analytics') }, { label: t('nav.breakdown') }]" icon="M3 3v18h18M7 14l4-4 3 3 5-6" :title="t('breakdownPage.breakdown')">
      <div class="actions">
        <Button variant="link" :to="chartsRoute" data-testid="open-charts">{{ t("breakdownPage.open_in_custom_charts") }}</Button>
        <Button variant="secondary" :disabled="items.length === 0" data-testid="export-csv" @click="exportCsv">{{ t("breakdownPage.export_csv") }}</Button>
      </div>
    </PageHeader>

    <ErrorBanner v-if="breakdown.error.value" :error="breakdown.error.value" @retry="breakdown.run()" />
    <LoadingState v-else-if="breakdown.loading.value && !breakdown.data.value" size="lg" />

    <Card v-else padding="none" block class="main-card">
      <header class="head">
        <div class="head-text">
          <h2>{{ byNoun("breakdownPage.compareHeading") }}</h2>
          <p class="muted">{{ t("breakdownPage.always_two_at_a_time_a") }} {{ t("breakdownPage.scope_hint") }}</p>
        </div>
        <span class="group-label">{{ t("breakdownPage.group_by") }}</span>
        <SegmentedControl :options="GROUPS" :model-value="groupBy" :aria-label="t('breakdownPage.group_by2')" data-testid="group-tabs" @update:model-value="setGroup" />
      </header>

      <EmptyState v-if="items.length === 0" icon="bar_chart" :title="t('breakdownPage.nothing_to_analyse_yet')" data-testid="breakdown-empty">
        {{ t("breakdownPage.no_traces_in_this_range") }} {{ emptyHint }}
      </EmptyState>

      <template v-else>
        <div v-if="breakdown.data.value && breakdown.data.value.unpricedTokens > 0" class="note" data-testid="breakdown-unpriced">
          {{ t("breakdownPage.count_tokens_use_a_model_with", { count: formatCount(breakdown.data.value.unpricedTokens) }) }}
          <router-link :to="{ name: 'model-pricing' }">{{ t("breakdownPage.see_model_pricing") }}</router-link>
        </div>

        <div v-if="insight && !only" class="insight" data-testid="breakdown-insight">
          <span class="insight-dot" aria-hidden="true">!</span>
          <span class="insight-text">
            <strong>{{ t("breakdownPage.key_fails_percent_of_the_time", { key: insight.worst.key, percent: errorText(insight.worst) }) }}</strong>
            {{ t("breakdownPage.against_percent_in_key", { percent: errorText(insight.best), key: insight.best.key }) }}
            <span class="muted">{{ t("breakdownPage.their_ranges_do_not_overlap_so") }}</span>
          </span>
          <Button variant="secondary" size="sm" data-testid="insight-compare" @click="compareInsight">{{ t("breakdownPage.compare_with_key", { key: insight.best.key }) }}</Button>
        </div>

        <div class="pair" data-testid="breakdown-pair">
          <div v-for="s in slots" :key="s.letter" class="slot" :class="[`role-${s.letter.toLowerCase()}`, { filled: !!s.item, next: s.next }]" :data-testid="`slot-${s.letter}`">
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
            <Button v-if="!only && (keyA || keyB)" variant="link" size="sm" data-testid="clear-pair" @click="clear">{{ t("breakdownPage.clear") }}</Button>
          </div>
        </div>

        <DataTable class="breakdown" sticky nowrap bare>
          <thead>
            <tr>
              <th class="pick">{{ t("breakdownPage.set") }}</th>
              <th>{{ nameLabel }}</th>
              <th>{{ relatedLabel }}</th>
              <th class="num">{{ t("breakdownPage.traces") }}</th>
              <th class="num">{{ t("breakdownPage.errors_95") }}</th>
              <th class="num">p95</th>
              <th class="num">{{ t("breakdownPage.cost_trace") }}</th>
              <th class="num">{{ t("breakdownPage.total_cost") }}</th>
              <th>{{ t("breakdownPage.errors_7_days") }}</th>
              <th class="num">{{ t("breakdownPage.rate") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in items"
              :key="i.key"
              :class="[letterOf(i.key) ? `on on-${letterOf(i.key).toLowerCase()}` : '', { few: few(i), pickable: !only }]"
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
                  :aria-label="letterOf(i.key) ? t('breakdownPage.key_is_letter_click_to_clear', { key: i.key, letter: letterOf(i.key) }) : t('breakdownPage.set_key_as_letter', { key: i.key, letter: nextLetter })"
                  :title="letterOf(i.key) ? t('breakdownPage.click_to_clear') : t('breakdownPage.set_as_letter', { letter: nextLetter })"
                  :data-testid="`pick-${i.key}`"
                  @click.stop="pick(i.key)"
                >
                  <span aria-hidden="true">{{ letterOf(i.key) || nextLetter }}</span>
                </Button>
              </td>
              <td class="name">
                <span v-if="letterOf(i.key)" class="badge" :class="`badge-${letterOf(i.key).toLowerCase()}`" aria-hidden="true">{{ letterOf(i.key) }}</span>
                <span class="key">{{ i.key }}</span>
                <Pill v-if="few(i)" tone="warn">{{ t("breakdownPage.few_traces") }}</Pill>
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
                <svg class="spark" width="110" height="26" viewBox="0 0 110 26" role="img" :aria-label="t('breakdownPage.error_rate_over_the_last_7', { key: i.key })">
                  <path :d="spark(i)" fill="none" :stroke="isBad(i) ? 'var(--mt-err-ink)' : 'var(--mt-accent)'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                </svg>
              </td>
              <td class="num muted">{{ i.thumbsUpRate === null ? "–" : formatPercent(i.thumbsUpRate) }}</td>
            </tr>
          </tbody>
        </DataTable>
        <p class="foot muted">
          {{ t("breakdownPage.the_is_the_95_margin_when", { min: MIN_TRACES }) }}
        </p>

        <section v-if="only" class="guide" data-testid="breakdown-guide">
          <div class="guide-text">
            <strong>{{ byNoun("breakdownPage.needSecond") }}</strong>
            <span class="muted">
              <template v-if="groupBy === 'environment'">{{ t("breakdownPage.run_the_agent_in_another_environment") }}</template>
              <template v-else-if="groupBy === 'user'">{{ t("breakdownPage.another_user_will_show_up_here") }}</template>
              <template v-else>{{ t("breakdownPage.publish_a_new_version_of_the") }}</template>
            </span>
          </div>
          <Button v-if="groupBy === 'prompt_version'" variant="primary" :to="{ name: 'prompts' }" data-testid="guide-prompts">{{ t("breakdownPage.open_prompts") }}</Button>
        </section>

        <section v-else-if="compared" class="compare" data-testid="breakdown-compare">
          <div class="compare-head">
            <span class="tag tag-a">A</span><strong>{{ compared.a.key }}</strong><span class="muted">{{ t("breakdownPage.against") }}</span><span class="tag tag-b">B</span><strong>{{ compared.b.key }}</strong>
            <Pill v-if="compared.a.related.join() !== compared.b.related.join()" tone="info" data-testid="compare-differs">
              {{ groupBy === "environment" ? t("breakdownPage.run_different_versions") : t("breakdownPage.seen_in_different_environments") }}
            </Pill>
          </div>
          <div class="cells">
            <div v-for="c in compared.cells" :key="c.label" class="cell" :data-testid="`delta-${c.label}`">
              <span class="cell-label">{{ c.label }}</span>
              <span class="cell-range"><span class="from">{{ c.from }}</span> <span class="muted">→</span> <strong class="to">{{ c.to }}</strong></span>
              <span class="cell-delta" :class="c.tone">{{ c.delta }}</span>
              <span class="cell-note muted">{{ c.note }}</span>
            </div>
          </div>
        </section>

        <section v-else class="compare idle" data-testid="breakdown-compare-empty">
          <span class="compare-title">{{ byNoun("breakdownPage.whatChanges") }}</span>
          <div class="cells">
            <div v-for="l in PLACEHOLDER_CELLS" :key="l" class="cell ghost">
              <span class="cell-label">{{ l }}</span>
              <span class="cell-delta muted">–</span>
            </div>
          </div>
          <span class="muted compare-note">{{ t("breakdownPage.pick_a_and_b_above_and") }}</span>
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
/* A usa el acento (turquesa) y B el terracota de la marca; cada una su color en todo el flujo: hueco, círculo, fila, etiqueta y cifras de la comparación */
.slot.role-a.next,
.slot.role-a.filled {
  border-color: var(--mt-accent);
}
.slot.role-b.next,
.slot.role-b.filled {
  border-color: var(--mt-highlight);
}
.slot.role-a.next {
  box-shadow: 0 0 0 3px var(--mt-accent-soft);
}
.slot.role-b.next {
  box-shadow: 0 0 0 3px var(--mt-highlight-soft);
}
.slot.role-a .letter,
.slot.role-a .slot-role {
  border-color: var(--mt-accent);
  color: var(--mt-accent-text);
}
.slot.role-b .letter,
.slot.role-b .slot-role {
  border-color: var(--mt-highlight);
  color: var(--mt-highlight-ink);
}
.slot.role-a.filled .letter {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.slot.role-b.filled .letter {
  background: var(--mt-highlight);
  color: var(--mt-card);
}
.slot.role-a.next .slot-empty {
  color: var(--mt-accent-text);
}
.slot.role-b.next .slot-empty {
  color: var(--mt-highlight-ink);
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
tr.on-a {
  background: var(--mt-accent-soft);
  box-shadow: inset 3px 0 0 var(--mt-accent);
}
tr.on-b {
  background: var(--mt-highlight-soft);
  box-shadow: inset 3px 0 0 var(--mt-highlight);
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
  color: var(--mt-card);
}
.pick-btn.a {
  border-color: var(--mt-accent);
  background: var(--mt-accent);
}
.pick-btn.b {
  border-color: var(--mt-highlight);
  background: var(--mt-highlight);
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
.badge,
.tag {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  color: var(--mt-card);
}
.badge-a,
.tag-a {
  background: var(--mt-accent);
}
.badge-b,
.tag-b {
  background: var(--mt-highlight);
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
.cell-note {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cell-range {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.cell-range .from {
  color: var(--mt-accent-text);
  font-weight: 700;
}
.cell-range .to {
  color: var(--mt-highlight-ink);
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
