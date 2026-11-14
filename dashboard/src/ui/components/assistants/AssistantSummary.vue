<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { AssistantCardDto, DeployRunDto } from "@contract";
import { DEFAULT_PERIOD, SUMMARY_PERIODS, buildAgentSummary, periodRange, type SummaryPeriod, type SummaryTone } from "@/domain/agent-summary";
import { formatRelativeTime } from "@/domain/format";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { useTraceApi } from "../../composables/useTraceApi";
import { t } from "../../i18n";
import Card from "../Card.vue";
import LoadingState from "../LoadingState.vue";
import SegmentedControl from "../SegmentedControl.vue";

/**
 * Resumen de un agente (ficha del asistente): salud, coste, calidad, seguridad y alertas de un vistazo, qué cambió y por qué
 * fallan las ejecuciones. Todo habla del mismo periodo (por defecto, este mes) y se compara con el anterior. Cada parte se
 * carga por separado y se omite si falla o si la persona no tiene permiso para verla.
 */
const props = defineProps<{ card: AssistantCardDto; experimentId: string }>();

const route = useRoute();
const router = useRouter();
const nowMs = ref(Date.now());

// el periodo viaja en el enlace (`?period=`) para poder compartir la vista
const period = computed<SummaryPeriod>(() => {
  const q = route.query.period;
  return SUMMARY_PERIODS.includes(q as SummaryPeriod) ? (q as SummaryPeriod) : DEFAULT_PERIOD;
});
const periodOptions = computed(() => SUMMARY_PERIODS.map((p) => ({ value: p, label: t(`agentSummary.period_${p}`) })));
function setPeriod(value: unknown) {
  void router.replace({ query: { ...route.query, period: value === DEFAULT_PERIOD ? undefined : String(value) } });
}

const assistantApi = useAssistantApi();
const identityApi = useIdentityApi();
const traceApi = useTraceApi();

const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);

const summary = useAsync(async (signal) => {
  const id = props.experimentId;
  const scoped = traceApi.forExperiment(id);
  const range = periodRange(period.value);
  const current = { from: range.from.toISOString(), to: range.to.toISOString() };
  const before = { from: range.previousFrom.toISOString(), to: range.previousTo.toISOString() };
  const deployments = props.card.deployments;
  const [overview, previousOverview, alerts, security, securityTwice, errors, runs, ...deploys] = await Promise.allSettled([
    traceApi.getOverviewForExperiment(id, current, signal),
    traceApi.getOverviewForExperiment(id, before, signal),
    identityApi.getAlerts(id, signal),
    assistantApi.getSecurity(id, range.days, signal),
    // the daily series of twice the days holds the span before as its first half
    assistantApi.getSecurity(id, range.days * 2, signal),
    scoped.getErrorOverview(current, signal),
    scoped.listRuns(signal),
    ...deployments.map((d) => assistantApi.listDeploys(id, d.id, signal)),
  ]);
  nowMs.value = Date.now();
  const twice = ok(securityTwice);
  return buildAgentSummary({
    period: range,
    overview: ok(overview),
    previousOverview: ok(previousOverview),
    alerts: ok(alerts),
    security: ok(security),
    previousSecurityEvents: twice ? twice.events.daily.slice(0, Math.max(0, twice.events.daily.length - range.days)).reduce((sum, d) => sum + d.count, 0) : null,
    errors: ok(errors),
    runs: ok(runs)?.items ?? null,
    deploys: (deploys as PromiseSettledResult<DeployRunDto[]>[]).flatMap((d) => (d.status === "fulfilled" ? d.value : [])),
    environmentOf: Object.fromEntries(deployments.map((d) => [d.id, d.environment.label])),
  });
});
watch(period, () => void summary.run(), { immediate: true });

const data = computed(() => summary.data.value);
const empty = computed(() => data.value !== null && data.value.health === null && data.value.cards.length === 0);

const LINK: Record<string, string> = { reliability: "conversations", cost: "alerts", quality: "runs", security: "security", alerts: "alerts" };
const TONE_CLASS: Record<SummaryTone, string> = { ok: "t-ok", warn: "t-warn", error: "t-error", neutral: "t-neutral" };
</script>

<template>
  <section v-if="!empty" class="summary" data-testid="agent-summary" :aria-label="t('agentSummary.title')">
    <div class="bar-top">
      <h2>{{ t("agentSummary.title") }}</h2>
      <span class="note muted">{{ t(period === "month" ? "agentSummary.compare_note_month" : "agentSummary.compare_note_rolling") }}</span>
      <SegmentedControl size="sm" :aria-label="t('agentSummary.period_label')" :options="periodOptions" :model-value="period" data-testid="summary-period" @update:model-value="setPeriod" />
    </div>

    <LoadingState v-if="!data" size="md" />
    <template v-else>
      <div v-if="data.health" class="health" :class="TONE_CLASS[data.health.tone]" role="status" data-testid="summary-health">
        <div class="health-text">
          <strong>{{ data.health.title }}</strong>
          <span>{{ data.health.text }}</span>
        </div>
      </div>

      <div class="cards">
        <Card v-for="c in data.cards" :key="c.id" as="router-link" :to="{ name: LINK[c.id], params: { experimentId } }" class="kpi" :data-testid="`summary-card-${c.id}`">
          <span class="kpi-label">{{ c.label }}</span>
          <span class="kpi-value" :class="TONE_CLASS[c.tone]">{{ c.value }}</span>
          <span v-if="c.delta" class="kpi-delta" :class="TONE_CLASS[c.delta.tone]" :data-testid="`summary-delta-${c.id}`">{{ c.delta.text }}</span>
          <span class="kpi-sub">{{ c.sub }}</span>
        </Card>
      </div>

      <div class="columns">
        <Card as="section" class="panel" data-testid="summary-events">
          <header class="panel-head"><h3>{{ t("agentSummary.events_title") }}</h3></header>
          <p v-if="data.events.length === 0" class="muted empty">{{ t("agentSummary.events_empty") }}</p>
          <ol v-else class="events">
            <li v-for="e in data.events" :key="e.id" class="event">
              <span class="when">{{ formatRelativeTime(e.at, nowMs) }}</span>
              <span class="dot" :class="TONE_CLASS[e.tone]" aria-hidden="true"></span>
              <span class="what"><b>{{ e.title }}</b><small v-if="e.text">{{ e.text }}</small></span>
            </li>
          </ol>
        </Card>

        <Card v-if="data.causes.length > 0" as="section" class="panel" data-testid="summary-causes">
          <header class="panel-head">
            <h3>{{ t("agentSummary.causes_title") }}</h3>
            <router-link :to="{ name: 'overview', params: { experimentId } }" class="link">{{ t("agentSummary.all_errors") }} →</router-link>
          </header>
          <ul class="causes">
            <li v-for="c in data.causes" :key="c.id">
              <span class="cause-line"><b>{{ c.title }}</b><small class="muted">{{ t("agentSummary.cause_count", { count: c.occurrences, share: c.share }) }} · {{ t(`agentSummary.trend_${c.trend}`) }}</small></span>
              <span class="bar"><span class="fill" :style="{ width: `${c.share}%` }"></span></span>
            </li>
          </ul>
        </Card>
      </div>
    </template>
  </section>
</template>

<style scoped>
.summary { display: flex; flex-direction: column; gap: 12px; }
.bar-top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.bar-top h2 { margin: 0; font-size: 15px; font-weight: 800; }
.note { flex: 1; }
.health { padding: 12px 16px; border-radius: var(--mt-radius); }
.health-text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.health strong { font-size: 15px; font-weight: 800; }
.health.t-ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.health.t-warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.health.t-error { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.health.t-neutral { background: var(--mt-card); color: var(--mt-muted); border: 1px solid var(--mt-line); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.kpi { gap: 4px; text-decoration: none; color: inherit; }
.kpi:hover { border-color: var(--mt-accent); }
.kpi-label { font-size: 12px; font-weight: 700; color: var(--mt-muted); }
.kpi-value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.15; }
.kpi-value.t-error { color: var(--mt-err-ink); }
.kpi-value.t-warn { color: var(--mt-warn-ink); }
.kpi-delta { font-size: 12px; font-weight: 700; color: var(--mt-muted); }
.kpi-delta.t-ok { color: var(--mt-ok-ink); }
.kpi-delta.t-error { color: var(--mt-err-ink); }
.kpi-sub { font-size: 12px; color: var(--mt-muted); }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
.panel { gap: 10px; }
.panel-head { display: flex; align-items: center; gap: 10px; }
.panel-head h3 { margin: 0; flex: 1; font-size: 14px; font-weight: 800; }
.muted { color: var(--mt-muted); font-size: 12px; }
.empty { margin: 0; }
.link { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); text-decoration: none; }
.link:hover { text-decoration: underline; }
.events, .causes { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
.event { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; }
.when { width: 72px; flex: none; font-size: 11.5px; color: var(--mt-muted); padding-top: 2px; }
.dot { width: 8px; height: 8px; flex: none; margin-top: 5px; border-radius: 50%; background: var(--mt-faint); }
.dot.t-ok { background: var(--mt-ok); }
.dot.t-error { background: var(--mt-err); }
.dot.t-warn { background: var(--mt-warn); }
.what { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.what small { font-size: 12px; color: var(--mt-muted); }
.cause-line { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; }
.bar { display: block; height: 6px; margin-top: 5px; border-radius: 3px; background: var(--mt-bg); }
.fill { display: block; height: 100%; border-radius: 3px; background: var(--mt-err); }
</style>
