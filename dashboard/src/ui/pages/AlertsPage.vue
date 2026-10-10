<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import type { AlertEventDto, AlertRuleDto, AlertRuleWithStatusDto, BudgetViewDto } from "@contract";
import type { SavedCustomMetricDto } from "@/application/identity-api";
import { describeApiError } from "@/application/describe-api-error";
import { formatRelativeTime } from "@/domain/format";
import AlertRuleModal from "../components/AlertRuleModal.vue";
import BudgetModal from "../components/BudgetModal.vue";
import Button from "../components/Button.vue";
import Card from "../components/Card.vue";
import DataTable from "../components/DataTable.vue";
import PageHeader from "../components/PageHeader.vue";
import Pill from "../components/Pill.vue";
import { EVENT_LABEL, budgetTone, conditionText, emailedText, formatValue, metricLabel, stateOf } from "../alert-format";
import { useIdentityApi } from "../composables/useIdentityApi";
import { usePermissions } from "../composables/usePermissions";

/**
 * Overview › Alerts (ADR-086): las reglas del agente con su estado, el presupuesto mensual de coste y el historial. Cualquiera que pueda
 * leer el agente lo ve; crear, cambiar y borrar exige `alert:manage`.
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
const firing = computed(() => (rules.value ?? []).filter((r) => r.rule.enabled && r.status?.state === "firing").length);
const metricOf = (id: string): AlertRuleDto["metric"] => rules.value?.find((r) => r.rule.id === id)?.rule.metric ?? "custom";

async function saved() {
  editing.value = null;
  await load();
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
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Overview' }, { label: 'Alerts' }]" icon="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" title="Alerts" />

    <p v-if="error" class="banner" role="alert">{{ error }}</p>
    <p v-if="actionError" class="banner" role="alert">{{ actionError }}</p>

    <Card block class="section" data-testid="alert-rules">
      <div class="head">
        <div>
          <h2>Alerts</h2>
          <p class="sub">
            MemTrace checks each alert every 5 minutes and emails the people you choose when it fires and when it is back to normal.
            <template v-if="!can('alert:manage')"> You can see them; changing them needs the alert permission.</template>
          </p>
        </div>
        <Pill v-if="firing > 0" tone="error" dot data-testid="firing-count">{{ firing }} firing</Pill>
        <Button v-if="can('alert:manage')" variant="primary" data-testid="new-alert" @click="editing = 'new'">New alert</Button>
      </div>

      <p v-if="rules === null" class="muted">Loading…</p>
      <p v-else-if="rules.length === 0" class="empty" data-testid="no-alerts">
        No alerts yet.
        <template v-if="can('alert:manage')"> Start with one on the error rate or the latency, so you hear about a problem before your users do.</template>
      </p>
      <DataTable v-else bare>
        <thead>
          <tr>
            <th>Alert</th>
            <th>Status</th>
            <th>Now</th>
            <th>Email</th>
            <th v-if="can('alert:manage')" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rules" :key="item.rule.id" :data-testid="`rule-${item.rule.id}`">
            <td>
              <span class="strong">{{ item.rule.name }}</span>
              <span class="muted block">{{ conditionText(item.rule, chartName(item.rule)) }}</span>
            </td>
            <td>
              <Pill :tone="stateOf(item.rule, item.status).tone" dot>{{ stateOf(item.rule, item.status).label }}</Pill>
              <span v-if="item.status && item.rule.enabled" class="muted block">since {{ when(item.status.since) }}</span>
            </td>
            <td>{{ item.status && item.rule.enabled ? formatValue(item.rule.metric, item.status.lastValue) : "—" }}</td>
            <td>{{ item.rule.recipients.length === 0 ? "In the app only" : `${item.rule.recipients.length} address${item.rule.recipients.length === 1 ? "" : "es"}` }}</td>
            <td v-if="can('alert:manage')" class="actions">
              <Button size="sm" @click="editing = item.rule">Edit</Button>
              <Button v-if="confirmDelete !== item.rule.id" size="sm" variant="link" @click="confirmDelete = item.rule.id">Delete</Button>
              <template v-else>
                <Button size="sm" variant="danger" data-testid="confirm-delete" @click="remove(item.rule.id)">Delete for good</Button>
                <Button size="sm" variant="link" @click="confirmDelete = null">Keep</Button>
              </template>
            </td>
          </tr>
        </tbody>
      </DataTable>
    </Card>

    <Card block class="section" data-testid="alert-budget">
      <div class="head">
        <div>
          <h2>Monthly cost budget</h2>
          <p class="sub">An estimate from the price catalog. You are warned once a month at each level.</p>
        </div>
        <Button v-if="can('alert:manage')" :variant="budget ? 'secondary' : 'primary'" data-testid="set-budget" @click="editingBudget = true">{{ budget ? "Edit" : "Set a budget" }}</Button>
      </div>
      <p v-if="!budget" class="empty" data-testid="no-budget">No budget set. Without one, nobody is warned when this agent starts costing more than expected.</p>
      <template v-else>
        <div class="spend">
          <span class="amount">{{ formatValue("cost", budget.spentUsd) }}</span>
          <span class="muted">of {{ formatValue("cost", budget.budget.monthlyUsd) }} this month ({{ Math.round(budget.percent) }} %)</span>
          <Pill v-if="!budget.budget.enabled" tone="neutral">Paused</Pill>
          <Pill v-else-if="budget.percent >= 100" tone="error" dot>Exceeded</Pill>
          <Pill v-else-if="budget.percent >= budget.budget.warnPercent" tone="warn" dot>Warning</Pill>
        </div>
        <div class="bar" role="progressbar" :aria-valuenow="Math.round(budget.percent)" aria-valuemin="0" aria-valuemax="100" aria-label="Budget used">
          <div class="fill" :class="`t-${budgetTone(budget.percent, budget.budget.warnPercent)}`" :style="{ width: `${percentBar}%` }" />
          <div class="mark" :style="{ left: `${budget.budget.warnPercent}%` }" :title="`Warning at ${budget.budget.warnPercent} %`" />
        </div>
        <p class="muted" data-testid="forecast">
          <template v-if="budget.projectedUsd !== null">At this pace the month ends at <strong>{{ formatValue("cost", budget.projectedUsd) }}</strong>.</template>
          <template v-else>The forecast appears from the third day of the month.</template>
          {{ budget.budget.recipients.length ? `Emails go to ${budget.budget.recipients.length} address${budget.budget.recipients.length === 1 ? "" : "es"}.` : "Nobody is emailed: add an address to be warned." }}
        </p>
        <div v-if="can('alert:manage')" class="actions">
          <Button v-if="!confirmBudgetDelete" size="sm" variant="link" @click="confirmBudgetDelete = true">Remove budget</Button>
          <template v-else>
            <Button size="sm" variant="danger" data-testid="confirm-budget-delete" @click="removeBudget">Remove for good</Button>
            <Button size="sm" variant="link" @click="confirmBudgetDelete = false">Keep</Button>
          </template>
        </div>
      </template>
    </Card>

    <Card block class="section" data-testid="alert-history">
      <h2>History</h2>
      <p v-if="events.length === 0" class="empty">Nothing has fired yet.</p>
      <DataTable v-else bare>
        <thead>
          <tr>
            <th>When</th>
            <th>Alert</th>
            <th>Event</th>
            <th>Value</th>
            <th>Email</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td :title="e.at">{{ when(e.at) }}</td>
            <td>{{ ruleName(e.ruleId) }}</td>
            <td><Pill :tone="EVENT_LABEL[e.kind].tone" dot>{{ EVENT_LABEL[e.kind].label }}</Pill></td>
            <td>{{ formatValue(metricOf(e.ruleId), e.value) }} <span class="muted">vs {{ formatValue(metricOf(e.ruleId), e.threshold) }}</span></td>
            <td class="muted">{{ emailedText(e.emailed, rules?.find((r) => r.rule.id === e.ruleId)?.rule.recipients.length ?? null) }}</td>
          </tr>
        </tbody>
      </DataTable>
      <Button v-if="nextCursor" :loading="loadingMore" data-testid="older" @click="showOlder">Show older</Button>
    </Card>

    <AlertRuleModal v-if="editing" :experiment-id="experimentId" :rule="editing === 'new' ? undefined : editing" :charts="charts" @close="editing = null" @saved="saved" />
    <BudgetModal v-if="editingBudget" :experiment-id="experimentId" :budget="budget" @close="editingBudget = false" @saved="editingBudget = false; load()" />
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 24px 24px; background: var(--mt-bg); }
.section { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; }
.head { display: flex; align-items: flex-start; gap: 12px; }
.head > div { flex: 1; min-width: 0; }
h2 { margin: 0; font-size: 15px; font-weight: 700; }
.sub { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--mt-muted); max-width: 80ch; }
.muted { font-size: 12px; color: var(--mt-muted); }
.block { display: block; margin-top: 2px; }
.strong { font-weight: 600; }
.empty { margin: 0; font-size: 13px; color: var(--mt-muted); }
.banner { margin: 0; padding: 10px 14px; border-radius: var(--mt-radius-sm); background: var(--mt-err-bg, rgba(200, 40, 40, 0.1)); color: var(--mt-err-ink); font-size: 13px; font-weight: 600; }
.actions { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.spend { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.amount { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
.bar { position: relative; height: 10px; border-radius: 999px; background: var(--mt-soft, rgba(128, 128, 128, 0.18)); overflow: visible; }
.fill { height: 100%; border-radius: 999px; background: var(--mt-accent); }
.fill.t-warn { background: var(--mt-warn-ink, #b45309); }
.fill.t-error { background: var(--mt-err-ink, #b42318); }
.mark { position: absolute; top: -3px; width: 2px; height: 16px; background: var(--mt-ink); opacity: 0.45; }
</style>
