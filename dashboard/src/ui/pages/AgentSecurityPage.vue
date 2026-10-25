<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import Card from "../components/Card.vue";
import DataTable from "../components/DataTable.vue";
import EChart from "../components/EChart.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import KpiCard from "../components/KpiCard.vue";
import LoadingState from "../components/LoadingState.vue";
import PageHeader from "../components/PageHeader.vue";
import Pill from "../components/Pill.vue";
import SegmentedControl from "../components/SegmentedControl.vue";
import { useAssistantApi } from "../composables/useAssistantApi";
import { useAsync } from "../composables/useAsync";
import { dailyEventsOption } from "../security-chart-option";
import { SECURITY_PERIODS, asrTone, humanize, latestEvaluatedRun, parsePeriod, worstCategory } from "@/domain/agent-security";
import { formatCount, formatDateTime, formatPercent, shortRevision } from "@/domain/format";
import { t } from "../i18n";

/**
 * Seguridad del agente (ADR-103), de solo lectura: las detecciones que registran los detectores del SDK en producción y cómo
 * resistieron los últimos runs de red team. Nunca muestra el texto detectado (el SDK no lo guarda). Sin detectores ni runs
 * explica cómo empezar en lugar de enseñar ceros.
 */
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const api = useAssistantApi();

const experimentId = computed(() => route.params.experimentId as string);
const days = computed(() => parsePeriod(route.query.days));
const periods = SECURITY_PERIODS.map((d) => ({ value: d, get label() { return t("securityPage.days", { days: d }); }, testid: `period-${d}` }));
function setPeriod(value: unknown) {
  void router.replace({ query: { ...route.query, days: String(parsePeriod(value)) } });
}

const posture = useAsync((signal) => api.getSecurity(experimentId.value, days.value, signal));
watch([experimentId, days], () => void posture.run(), { immediate: true });

const data = computed(() => posture.data.value);
const latest = computed(() => (data.value ? latestEvaluatedRun(data.value) : null));
const chartOption = computed(() => (data.value ? dailyEventsOption(data.value.events.daily, $q.dark.isActive) : {}));
const actionTone = (action: string) => (action === "blocked" ? "error" : action === "warned" ? "warn" : "neutral");
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: t('nav.security') }]" :title="t('nav.security')">
      <SegmentedControl :options="periods" :model-value="days" size="sm" :aria-label="t('securityPage.period')" @update:model-value="setPeriod" />
    </PageHeader>

    <ErrorBanner v-if="posture.error.value" :error="posture.error.value" @retry="posture.run()" />
    <LoadingState v-else-if="!data" size="lg" />

    <template v-else>
      <section class="kpis">
        <KpiCard :label="t('securityPage.kpi_events')" :value="formatCount(data.events.total)" :hint="t('securityPage.kpi_events_hint', { days })" data-testid="kpi-events" />
        <KpiCard :label="t('securityPage.kpi_blocked')" :value="formatCount(data.events.blocked)" :hint="t('securityPage.kpi_blocked_hint')" :tone="data.events.blocked > 0 ? 'warning' : 'default'" data-testid="kpi-blocked" />
        <KpiCard
          :label="t('securityPage.kpi_asr')"
          :value="latest && latest.asr !== null ? formatPercent(latest.asr) : '–'"
          :hint="latest ? t('securityPage.kpi_asr_hint', { run: latest.name }) : t('securityPage.kpi_asr_none')"
          :tone="latest ? ({ ok: 'positive', warn: 'warning', error: 'negative', neutral: 'default' } as const)[asrTone(latest.asr)] : 'default'"
          data-testid="kpi-asr"
        />
      </section>

      <Card gap="md" data-testid="events-card">
        <h2>{{ t("securityPage.events_title") }}</h2>
        <EmptyState v-if="data.events.total === 0" icon="shield" :title="t('securityPage.events_empty_title')" data-testid="events-empty">{{ t("securityPage.events_empty_body") }}</EmptyState>
        <template v-else>
          <EChart :option="chartOption" :label="t('securityPage.events_title')" height="220px" />
          <div class="actions" data-testid="by-action">
            <span class="muted">{{ t("securityPage.by_action") }}</span>
            <Pill v-for="a in data.events.byAction" :key="a.action" :tone="actionTone(a.action)">{{ humanize(a.action) }} · {{ formatCount(a.count) }}</Pill>
          </div>
          <div class="tables">
            <div>
              <h3>{{ t("securityPage.by_detector") }}</h3>
              <DataTable density="sm" data-testid="by-detector">
                <thead><tr><th>{{ t("securityPage.col_detector") }}</th><th class="num">{{ t("securityPage.col_count") }}</th></tr></thead>
                <tbody>
                  <tr v-for="d in data.events.byDetector" :key="d.detector" :data-testid="`detector-${d.detector}`"><td>{{ humanize(d.detector) }}</td><td class="num">{{ formatCount(d.count) }}</td></tr>
                </tbody>
              </DataTable>
            </div>
            <div>
              <h3>{{ t("securityPage.by_category") }}</h3>
              <DataTable density="sm" data-testid="by-category">
                <thead><tr><th>{{ t("securityPage.col_category") }}</th><th class="num">{{ t("securityPage.col_count") }}</th></tr></thead>
                <tbody>
                  <tr v-for="c in data.events.byCategory" :key="c.category" :data-testid="`category-${c.category}`"><td>{{ humanize(c.category) }}</td><td class="num">{{ formatCount(c.count) }}</td></tr>
                </tbody>
              </DataTable>
            </div>
          </div>
        </template>
      </Card>

      <Card gap="md" data-testid="redteam-card">
        <div class="head">
          <h2>{{ t("securityPage.redteam_title") }}</h2>
          <p class="muted">{{ t("securityPage.redteam_help") }}</p>
        </div>
        <EmptyState v-if="data.redteam.runs.length === 0" icon="gpp_maybe" :title="t('securityPage.redteam_empty_title')" data-testid="redteam-empty">{{ t("securityPage.redteam_empty_body") }}</EmptyState>
        <DataTable v-else bare data-testid="redteam-runs">
          <thead>
            <tr>
              <th>{{ t("securityPage.col_run") }}</th><th>{{ t("securityPage.col_date") }}</th><th>{{ t("securityPage.col_commit") }}</th>
              <th class="num">{{ t("securityPage.col_items") }}</th><th class="num">{{ t("securityPage.col_succeeded") }}</th><th class="num">{{ t("securityPage.col_asr") }}</th><th>{{ t("securityPage.col_categories") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in data.redteam.runs" :key="run.runId" :data-testid="`run-${run.runId}`">
              <td class="strong">
                <router-link :to="{ name: 'dataset-run', params: { experimentId, datasetId: run.datasetId, runId: run.runId } }" :data-testid="`run-link-${run.runId}`">{{ run.name }}</router-link>
                <div v-if="run.errored > 0" class="muted small">{{ t("securityPage.errored", { count: run.errored }) }}</div>
              </td>
              <td class="muted">{{ formatDateTime(run.createdAt) }}</td>
              <td class="mono">{{ shortRevision(run.revision) }}</td>
              <td class="num">{{ formatCount(run.items) }}</td>
              <td class="num">{{ formatCount(run.attacksSucceeded) }}</td>
              <td class="num"><Pill :tone="asrTone(run.asr)" :data-testid="`asr-${run.runId}`">{{ run.asr === null ? "–" : formatPercent(run.asr) }}</Pill></td>
              <td>
                <span v-if="!worstCategory(run)" class="muted">{{ t("securityPage.none_succeeded") }}</span>
                <span v-else class="chips">
                  <Pill v-for="c in run.byCategory" :key="c.category" :tone="asrTone(c.asr)" outline :data-testid="`cat-${run.runId}-${c.category}`">{{ humanize(c.category) }} {{ c.asr === null ? "–" : formatPercent(c.asr) }}</Pill>
                </span>
              </td>
            </tr>
          </tbody>
        </DataTable>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 24px 24px; background: var(--mt-bg); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
h2 { margin: 0; font-size: 15px; font-weight: 700; color: var(--mt-ink); }
h3 { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mt-muted); }
.head { display: flex; flex-direction: column; gap: 4px; }
.head p { margin: 0; font-size: 13px; }
.muted { color: var(--mt-muted); }
.small { font-size: 12px; font-weight: 400; }
.mono { font-family: var(--mt-mono); font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 13px; }
.tables { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }
.chips { display: inline-flex; flex-wrap: wrap; gap: 6px; }
</style>
