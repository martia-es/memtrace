<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { AlertEventDto, AlertRuleDto, AlertRuleWithStatusDto, BudgetViewDto } from "@contract";
import type { SavedCustomMetricDto } from "@/application/identity-api";
import { describeApiError } from "@/application/describe-api-error";
import { formatRelativeTime } from "../i18n/format";
import AlertRuleModal from "../components/AlertRuleModal.vue";
import BudgetModal from "../components/BudgetModal.vue";
import Button from "../components/Button.vue";
import Card from "../components/Card.vue";
import PageHeader from "../components/PageHeader.vue";
import Pill from "../components/Pill.vue";
import Switch from "../components/Switch.vue";
import ToggleChip from "../components/ToggleChip.vue";
import { EVENT_LABEL, GAUGE_LIMIT_AT, budgetTone, conditionText, emailedText, formatValue, gaugeFill, stateOf } from "../alert-format";
import { useIdentityApi } from "../composables/useIdentityApi";
import { usePermissions } from "../composables/usePermissions";
import { t, tp, dateLocale } from "../i18n";

/**
 * Overview › Alerts (ADR-086): lo que se está rompiendo arriba, las reglas con su valor frente al límite, el presupuesto mensual
 * de coste y el historial por días. Cualquiera que pueda leer el agente lo ve; crear, cambiar, pausar y borrar exige `alert:manage`.
 */
const route = useRoute();
const api = useIdentityApi();
const { can } = usePermissions();
const experimentId = computed(() => route.params.experimentId as string);

const rules = ref<AlertRuleWithStatusDto[] | null>(null);
const events = ref<AlertEventDto[]>([]);
const nextCursor = ref<string | null>(null);
const budget = ref<BudgetViewDto | null>(null);
const charts = ref<SavedCustomMetricDto[]>([]);
const error = ref<string | null>(null);
const now = ref(Date.now());

const editing = ref<AlertRuleDto | "new" | null>(null);
const editingBudget = ref(false);
const confirmDelete = ref<string | null>(null);
const confirmBudgetDelete = ref(false);
const actionError = ref<string | null>(null);
const loadingMore = ref(false);

async function load() {
  try {
    const overview = await api.getAlerts(experimentId.value);
    rules.value = overview.rules;
    events.value = overview.events;
    // la primera página del historial viene con el resumen; «Show older» pide las siguientes
    nextCursor.value = overview.events.length >= 20 ? overview.events[overview.events.length - 1]!.id : null;
    budget.value = overview.budget;
    error.value = null;
    now.value = Date.now();
  } catch (e) {
    error.value = describeApiError(e as Error);
    if (rules.value === null) rules.value = [];
  }
}

async function loadCharts() {
  try {
    charts.value = await api.listCustomMetrics(experimentId.value);
  } catch {
    charts.value = [];
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  void loadCharts();
  timer = setInterval(() => void load(), 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

const chartName = (rule: AlertRuleDto): string | null => (rule.customMetricId ? (charts.value.find((c) => c.id === rule.customMetricId)?.name ?? null) : null);
const ruleName = (id: string): string => rules.value?.find((r) => r.rule.id === id)?.rule.name ?? "(deleted alert)";
const metricOf = (id: string): AlertRuleDto["metric"] => rules.value?.find((r) => r.rule.id === id)?.rule.metric ?? "custom";

type Filter = "all" | "firing" | "healthy" | "paused";
const filter = ref<Filter>("all");
const isFiring = (r: AlertRuleWithStatusDto) => r.rule.enabled && r.status?.state === "firing";
const isPaused = (r: AlertRuleWithStatusDto) => !r.rule.enabled;
const counts = computed(() => {
  const all = rules.value ?? [];
  return { all: all.length, firing: all.filter(isFiring).length, healthy: all.filter((r) => !isFiring(r) && !isPaused(r)).length, paused: all.filter(isPaused).length };
});
const FILTERS: ReadonlyArray<{ key: Filter; label: string }> = [
  { key: "all", get label() { return t("alertsPage.all"); } },
  { key: "firing", get label() { return t("alertsPage.firing"); } },
  { key: "healthy", get label() { return t("alertsPage.healthy"); } },
  { key: "paused", get label() { return t("alertsPage.paused"); } },
];
/** Lo que se está rompiendo va arriba; lo pausado, abajo. */
const rank = (r: AlertRuleWithStatusDto) => (isFiring(r) ? 0 : isPaused(r) ? 2 : 1);
const matches = (r: AlertRuleWithStatusDto): boolean => {
  if (filter.value === "all") return true;
  if (filter.value === "firing") return isFiring(r);
  if (filter.value === "paused") return isPaused(r);
  return !isFiring(r) && !isPaused(r);
};
const visible = computed(() =>
  (rules.value ?? [])
    .map((r, i) => ({ r, i }))
    .filter((x) => matches(x.r))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r),
);
const firingNames = computed(() => (rules.value ?? []).filter(isFiring).map((r) => r.rule.name));

const gaugeOf = (item: AlertRuleWithStatusDto) => (item.rule.enabled && item.status ? gaugeFill(item.status.lastValue, item.rule.threshold) : null);
const recipientsText = (n: number) => (n === 0 ? t("alertsPage.in_the_app_only") : tp("alertsPage.addresses", n));

async function saved() {
  editing.value = null;
  await load();
}

/** El interruptor pausa o reactiva la alerta con la misma regla, cambiando solo `enabled`. */
async function toggle(item: AlertRuleWithStatusDto) {
  actionError.value = null;
  const { id: _id, experimentId: _experiment, createdAt: _created, updatedAt: _updated, ...body } = item.rule;
  try {
    await api.updateAlertRule(experimentId.value, item.rule.id, { ...body, enabled: !item.rule.enabled });
    await load();
  } catch (e) {
    actionError.value = describeApiError(e as Error);
  }
}

async function remove(ruleId: string) {
  actionError.value = null;
  try {
    await api.deleteAlertRule(experimentId.value, ruleId);
    confirmDelete.value = null;
    await load();
  } catch (e) {
    actionError.value = describeApiError(e as Error);
  }
}

async function removeBudget() {
  actionError.value = null;
  try {
    await api.deleteBudget(experimentId.value);
    confirmBudgetDelete.value = false;
    await load();
  } catch (e) {
    actionError.value = describeApiError(e as Error);
  }
}

async function showOlder() {
  if (!nextCursor.value) return;
  loadingMore.value = true;
  try {
    const page = await api.listAlertEvents(experimentId.value, nextCursor.value);
    events.value = [...events.value, ...page.items];
    nextCursor.value = page.nextCursor;
  } catch (e) {
    actionError.value = describeApiError(e as Error);
  } finally {
    loadingMore.value = false;
  }
}

const when = (iso: string) => formatRelativeTime(iso, now.value);
const percentBar = computed(() => Math.min(100, Math.max(0, budget.value?.percent ?? 0)));

/** Los eventos agrupados por día, del más reciente al más antiguo. */
const history = computed(() => {
  const groups: Array<{ day: string; events: AlertEventDto[] }> = [];
  const today = new Date(now.value).toDateString();
  const yesterday = new Date(now.value - 86_400_000).toDateString();
  for (const e of events.value) {
    const d = new Date(e.at);
    const day = d.toDateString() === today ? t("alertsPage.today") : d.toDateString() === yesterday ? t("time.yesterday") : d.toLocaleDateString(dateLocale("en-GB"), { day: "numeric", month: "short", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
});
const EVENT_VERB = (kind: AlertEventDto["kind"]): string => ({ fired: t("alertsPage.went_over_its_limit"), reminder: t("alertsPage.is_still_over_its_limit"), resolved: t("alertsPage.is_back_to_normal") })[kind];
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: t('nav.overview') }, { label: t('nav.alerts') }]" icon="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" :title="t('nav.alerts')">
      <Button v-if="can('alert:manage')" variant="primary" data-testid="new-alert" @click="editing = 'new'">{{ t("alertsPage.new_alert") }}</Button>
    </PageHeader>

    <p v-if="error" class="banner" role="alert">{{ error }}</p>
    <p v-if="actionError" class="banner" role="alert">{{ actionError }}</p>

    <section v-if="counts.firing > 0" class="firing" data-testid="firing-count" role="status">
      <span class="firing-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 17h.01" /></svg>
      </span>
      <div class="firing-text">
        <strong>{{ tp("alertsPage.firingNow", counts.firing) }}</strong>
        <span>{{ tp("alertsPage.overLimit", counts.firing, { names: firingNames.join(", ") }) }}</span>
      </div>
    </section>

    <div class="grid">
      <section class="rules" data-testid="alert-rules">
        <div class="rules-head">
          <h2>{{ t("alertsPage.your_alerts") }}</h2>
          <div class="chips" role="group" :aria-label="t('alertsPage.filter_alerts')">
            <ToggleChip v-for="f in FILTERS" :key="f.key" :pressed="filter === f.key" :count="counts[f.key]" @click="filter = f.key">{{ f.label }}</ToggleChip>
          </div>
          <span class="muted every">{{ t("alertsPage.checked_every_5_minutes") }}</span>
        </div>
        <p v-if="!can('alert:manage')" class="muted">{{ t("alertsPage.you_can_see_them_changing_them") }}</p>

        <p v-if="rules === null" class="muted">{{ t("alertsPage.loading") }}</p>
        <p v-else-if="rules.length === 0" class="empty" data-testid="no-alerts">
          {{ t("alertsPage.no_alerts_yet") }}
          <template v-if="can('alert:manage')"> {{ t("alertsPage.start_with_one_on_the_error") }}</template>
        </p>
        <p v-else-if="visible.length === 0" class="empty">{{ t("alertsPage.no_alerts_in_this_view") }}</p>

        <article v-for="item in visible" :key="item.rule.id" class="rule" :class="{ firing: isFiring(item), paused: isPaused(item) }" :data-testid="`rule-${item.rule.id}`">
          <span class="rule-icon" :class="`t-${stateOf(item.rule, item.status).tone}`" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="isFiring(item)" d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
              <path v-else-if="isPaused(item)" d="M6 4h4v16H6zM14 4h4v16h-4z" />
              <path v-else d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          <div class="rule-main">
            <div class="rule-title">
              <span class="strong">{{ item.rule.name }}</span>
              <Pill :tone="stateOf(item.rule, item.status).tone" dot>{{ stateOf(item.rule, item.status).label }}</Pill>
            </div>
            <span class="muted">{{ conditionText(item.rule, chartName(item.rule)) }}</span>
            <span class="faint">
              <template v-if="item.status && item.rule.enabled">{{ t('alertsPage.since_when', { when: when(item.status.since) }) }} · </template>{{ recipientsText(item.rule.recipients.length) }}
            </span>
          </div>
          <div class="rule-now">
            <div class="now-line">
              <span class="now" :class="{ bad: isFiring(item) }">{{ item.status && item.rule.enabled ? formatValue(item.rule.metric, item.status.lastValue) : "—" }}</span>
              <span class="muted">{{ t('alertsPage.limit_value', { value: formatValue(item.rule.metric, item.rule.threshold) }) }}</span>
            </div>
            <div v-if="gaugeOf(item) !== null" class="gauge" aria-hidden="true">
              <div class="gauge-fill" :class="{ bad: isFiring(item) }" :style="{ width: `${gaugeOf(item)}%` }" />
              <div class="gauge-mark" :style="{ left: `${GAUGE_LIMIT_AT}%` }" />
            </div>
          </div>
          <div v-if="can('alert:manage')" class="actions">
            <Switch :on="item.rule.enabled" :aria-label="t(item.rule.enabled ? 'alertsPage.pause_name' : 'alertsPage.resume_name', { name: item.rule.name })" data-testid="alert-switch" @click="toggle(item)" />
            <Button size="sm" @click="editing = item.rule">{{ t("alertsPage.edit") }}</Button>
            <Button v-if="confirmDelete !== item.rule.id" size="sm" variant="link" @click="confirmDelete = item.rule.id">{{ t("alertsPage.delete") }}</Button>
            <template v-else>
              <Button size="sm" variant="danger" data-testid="confirm-delete" @click="remove(item.rule.id)">{{ t("alertsPage.delete_for_good") }}</Button>
              <Button size="sm" variant="link" @click="confirmDelete = null">{{ t("alertsPage.keep") }}</Button>
            </template>
          </div>
        </article>
        <p v-if="rules && rules.length > 0" class="muted">{{ t("alertsPage.the_vertical_mark_on_each_bar") }}</p>
      </section>

      <Card block class="section" data-testid="alert-budget">
        <h2>{{ t("alertsPage.monthly_cost_budget") }}</h2>
        <p class="sub">{{ t("alertsPage.an_estimate_from_the_price_catalog") }}</p>
        <template v-if="!budget">
          <p class="nobudget" data-testid="no-budget">{{ t("alertsPage.no_budget_set_without_one_nobody") }}</p>
          <Button v-if="can('alert:manage')" variant="primary" data-testid="set-budget" @click="editingBudget = true">{{ t("alertsPage.set_a_budget") }}</Button>
        </template>
        <template v-else>
          <div class="spend">
            <span class="amount">{{ formatValue("cost", budget.spentUsd) }}</span>
            <span class="muted">{{ t('alertsPage.of_budget_this_month_percent', { budget: formatValue("cost", budget.budget.monthlyUsd), percent: Math.round(budget.percent) }) }}</span>
            <Pill v-if="!budget.budget.enabled" tone="neutral">{{ t("alertsPage.paused") }}</Pill>
            <Pill v-else-if="budget.percent >= 100" tone="error" dot>{{ t("alertsPage.exceeded") }}</Pill>
            <Pill v-else-if="budget.percent >= budget.budget.warnPercent" tone="warn" dot>{{ t("alertsPage.warning") }}</Pill>
          </div>
          <div class="bar" role="progressbar" :aria-valuenow="Math.round(budget.percent)" aria-valuemin="0" aria-valuemax="100" :aria-label="t('alertsPage.budget_used')">
            <div class="fill" :class="`t-${budgetTone(budget.percent, budget.budget.warnPercent)}`" :style="{ width: `${percentBar}%` }" />
            <div class="mark" :style="{ left: `${budget.budget.warnPercent}%` }" :title="t('alertsPage.warning_at_percent', { percent: budget.budget.warnPercent })" />
          </div>
          <p class="muted" data-testid="forecast">
            <template v-if="budget.projectedUsd !== null">{{ t('alertsPage.at_this_pace_the_month_ends') }} <strong>{{ formatValue("cost", budget.projectedUsd) }}</strong>.</template>
            <template v-else>{{ t("alertsPage.the_forecast_appears_from_the_third") }}</template>
            {{ budget.budget.recipients.length ? tp("alertsPage.emailsGo", budget.budget.recipients.length) : t("alertsPage.nobody_is_emailed_add_an_address") }}
          </p>
          <div v-if="can('alert:manage')" class="actions start">
            <Button size="sm" data-testid="set-budget" @click="editingBudget = true">{{ t("alertsPage.edit") }}</Button>
            <Button v-if="!confirmBudgetDelete" size="sm" variant="link" @click="confirmBudgetDelete = true">{{ t("alertsPage.remove_budget") }}</Button>
            <template v-else>
              <Button size="sm" variant="danger" data-testid="confirm-budget-delete" @click="removeBudget">{{ t("alertsPage.remove_for_good") }}</Button>
              <Button size="sm" variant="link" @click="confirmBudgetDelete = false">{{ t("alertsPage.keep") }}</Button>
            </template>
          </div>
        </template>
      </Card>
    </div>

    <Card block class="section" data-testid="alert-history">
      <h2>{{ t("alertsPage.history") }}</h2>
      <p v-if="events.length === 0" class="empty">{{ t("alertsPage.nothing_has_fired_yet") }}</p>
      <div v-for="g in history" :key="g.day" class="day">
        <span class="day-title">{{ g.day }}</span>
        <div v-for="e in g.events" :key="e.id" class="event" data-testid="history-row">
          <span class="event-icon" :class="`t-${EVENT_LABEL[e.kind].tone}`" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="e.kind === 'resolved'" d="M20 6L9 17l-5-5" />
              <path v-else d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
            </svg>
          </span>
          <span><span class="strong">{{ ruleName(e.ruleId) }}</span> <span class="muted">{{ EVENT_VERB(e.kind) }}</span></span>
          <span class="event-value"><span class="strong">{{ formatValue(metricOf(e.ruleId), e.value) }}</span> <span class="muted">{{ t('alertsPage.vs_value', { value: formatValue(metricOf(e.ruleId), e.threshold) }) }}</span></span>
          <span class="muted event-mail">{{ emailedText(e.emailed, rules?.find((r) => r.rule.id === e.ruleId)?.rule.recipients.length ?? null) }}</span>
          <span class="faint event-when" :title="e.at">{{ when(e.at) }}</span>
        </div>
      </div>
      <Button v-if="nextCursor" :loading="loadingMore" data-testid="older" @click="showOlder">{{ t("alertsPage.show_older") }}</Button>
    </Card>

    <AlertRuleModal v-if="editing" :experiment-id="experimentId" :rule="editing === 'new' ? undefined : editing" :charts="charts" @close="editing = null" @saved="saved" />
    <BudgetModal v-if="editingBudget" :experiment-id="experimentId" :budget="budget" @close="editingBudget = false" @saved="editingBudget = false; load()" />
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 16px; padding: 16px 24px 24px; background: var(--mt-bg); }
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
@media (max-width: 1000px) { .grid { grid-template-columns: minmax(0, 1fr); } }
.section { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
h2 { margin: 0; font-size: 15px; font-weight: 700; }
.sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--mt-muted); }
.muted { font-size: 12px; color: var(--mt-muted); }
.faint { font-size: 12px; color: var(--mt-faint, var(--mt-muted)); }
.strong { font-weight: 700; }
.empty { margin: 0; font-size: 13px; color: var(--mt-muted); }
.banner { margin: 0; padding: 10px 14px; border-radius: var(--mt-radius-sm); background: var(--mt-err-bg, rgba(200, 40, 40, 0.1)); color: var(--mt-err-ink); font-size: 13px; font-weight: 600; }

.firing { display: flex; align-items: center; gap: 14px; padding: 14px 18px; border-radius: var(--mt-radius-lg); background: var(--mt-err-bg); border: 1px solid var(--mt-err, var(--mt-err-ink)); }
.firing-icon { width: 36px; height: 36px; flex: none; border-radius: 50%; background: var(--mt-err-ink); color: #fff; display: flex; align-items: center; justify-content: center; }
.firing-text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--mt-muted); }
.firing-text strong { font-size: 16px; color: var(--mt-ink); }

.rules { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.rules-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.every { margin-left: auto; }

.rule { display: grid; grid-template-columns: 40px minmax(0, 1.3fr) minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 16px 18px; border-radius: var(--mt-radius-lg); background: var(--mt-card); border: 1px solid var(--mt-line); }
.rule.firing { border-color: var(--mt-err, var(--mt-err-ink)); }
.rule.paused { opacity: 0.7; }
@media (max-width: 1200px) { .rule { grid-template-columns: 40px minmax(0, 1fr); } .rule-now, .rule .actions { grid-column: 2; justify-content: flex-start; } }
.rule-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--mt-soft); color: var(--mt-muted); }
.rule-icon.t-error { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.rule-icon.t-ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.rule-icon.t-warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.rule-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.rule-title { display: flex; align-items: center; gap: 8px; font-size: 15px; flex-wrap: wrap; }
.rule-now { display: flex; flex-direction: column; gap: 8px; }
.now-line { display: flex; align-items: baseline; gap: 8px; }
.now { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.now.bad { color: var(--mt-err-ink); }
.gauge { position: relative; height: 6px; border-radius: 3px; background: var(--mt-soft); }
.gauge-fill { height: 100%; border-radius: 3px; background: var(--mt-ok); }
.gauge-fill.bad { background: var(--mt-err-ink); }
.gauge-mark { position: absolute; top: -4px; width: 2px; height: 14px; background: var(--mt-ink); opacity: 0.55; }
.actions { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.actions.start { justify-content: flex-start; }

.nobudget { margin: 0; padding: 14px; border-radius: var(--mt-radius-sm); border: 1px dashed var(--mt-line-2); background: var(--mt-soft); font-size: 13px; line-height: 1.45; color: var(--mt-muted); }
.spend { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.amount { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.bar { position: relative; height: 10px; border-radius: 999px; background: var(--mt-soft, rgba(128, 128, 128, 0.18)); overflow: visible; }
.fill { height: 100%; border-radius: 999px; background: var(--mt-accent); }
.fill.t-warn { background: var(--mt-warn-ink, #b45309); }
.fill.t-error { background: var(--mt-err-ink, #b42318); }
.mark { position: absolute; top: -3px; width: 2px; height: 16px; background: var(--mt-ink); opacity: 0.45; }

.day { display: flex; flex-direction: column; }
.day-title { padding: 8px 0 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mt-muted); }
.event { display: grid; grid-template-columns: 28px minmax(0, 1fr) 200px 110px 130px; gap: 14px; align-items: center; min-height: 46px; border-top: 1px solid var(--mt-line); font-size: 13px; }
@media (max-width: 1000px) { .event { grid-template-columns: 28px minmax(0, 1fr) auto; } .event-mail, .event-value { display: none; } }
.event-icon { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--mt-soft); color: var(--mt-muted); }
.event-icon.t-error { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.event-icon.t-ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.event-icon.t-warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.event-value { font-variant-numeric: tabular-nums; }
.event-when { text-align: right; }
</style>
