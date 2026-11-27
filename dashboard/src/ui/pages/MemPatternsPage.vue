<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";
import { useAsync } from "../composables/useAsync";
import PageHeader from "../components/PageHeader.vue";
import Button from "../components/Button.vue";
import Card from "../components/Card.vue";
import KpiCard from "../components/KpiCard.vue";
import Pill from "../components/Pill.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import LoadingState from "../components/LoadingState.vue";
import { formatCount, formatPercent } from "@/domain/format";
import { fixSnippet, presentFinding } from "@/domain/mem-finding";
import { t } from "../i18n";

const api = useTraceApi();
const route = useRoute();
const filters = useFilters();
const patterns = useAsync((signal) => api.getMemPatterns(filters.resolve(), signal));
watch(filters.rangeSig, () => void patterns.run(), { immediate: true });

const data = computed(() => patterns.data.value);
const raw = ref(new Set<string>());
function toggleRaw(id: string): void {
  const next = new Set(raw.value);
  if (!next.delete(id)) next.add(id);
  raw.value = next;
}
const views = computed(() =>
  (data.value?.findings ?? []).map((f) => ({ id: f.findingId, rate: f.failureRate, examples: f.exampleTraceIds, view: presentFinding(f), snippet: fixSnippet(f.findingId, f.decisiveStep) })),
);

const fixOpen = ref(new Set<string>());
function toggleFix(id: string): void {
  const next = new Set(fixOpen.value);
  if (!next.delete(id)) next.add(id);
  fixOpen.value = next;
}
const copied = ref<string | null>(null);
async function copySnippet(id: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = id;
    setTimeout(() => { if (copied.value === id) copied.value = null; }, 2000);
  } catch {
    // sin permiso de portapapeles el código sigue visible para seleccionarlo a mano
  }
}
const hasRun = computed(() => data.value?.runAt !== null && data.value?.runAt !== undefined);
</script>

<template>
  <div class="page" data-testid="mem-patterns-page">
    <PageHeader
      :crumbs="[{ label: t('nav.analytics') }, { label: t('nav.patterns') }]"
      icon="M4 19l5-5 4 3 7-9M4 5h16"
      :title="t('memPatterns.title')"
    />

    <ErrorBanner v-if="patterns.error.value" :error="patterns.error.value" @retry="patterns.run()" />
    <LoadingState v-else-if="patterns.loading.value && !data" size="lg" />
    <EmptyState v-else-if="!hasRun" icon="bar_chart" :title="t('memPatterns.noRun')" data-testid="mem-patterns-empty">
      {{ t('memPatterns.noRunHint') }}
    </EmptyState>

    <template v-else-if="data">
      <div class="summary-grid">
        <KpiCard :label="t('memPatterns.episodes')" :value="formatCount(data.episodes)" />
        <KpiCard :label="t('memPatterns.failed')" :value="formatCount(data.failed)" :tone="data.failed > 0 ? 'negative' : 'default'" />
        <KpiCard :label="t('memPatterns.unexplained')" :value="formatCount(data.unexplained)" :tone="data.unexplained > 0 ? 'warning' : 'default'" />
        <KpiCard :label="t('memPatterns.clusters')" :value="formatCount(data.goalClusters)" />
      </div>

      <Card padding="none" block class="findings-card">
        <header class="card-head">
          <div><h2>{{ t('memPatterns.findings') }}</h2><p class="muted">{{ t('memPatterns.findingsHint') }}</p></div>
          <Pill tone="info">{{ t('memPatterns.latestRun') }}</Pill>
        </header>
        <EmptyState v-if="data.findings.length === 0" icon="check" :title="t('memPatterns.noFindings')">
          {{ t('memPatterns.noFindingsHint') }}
        </EmptyState>
        <div v-else class="finding-list">
          <article v-for="finding in views" :key="finding.id" class="finding" data-testid="mem-finding">
            <div class="finding-main">
              <div class="finding-title">
                <Pill :tone="finding.view.infra ? 'neutral' : 'warn'" :dot="true">{{ finding.view.kindLabel }}</Pill>
                <Pill v-if="finding.view.infra" tone="info" outline>{{ t('memPatterns.infraTag') }}</Pill>
              </div>
              <h3 class="headline">{{ finding.view.title }}</h3>
              <p class="hint">{{ finding.view.hint }}</p>
              <div class="when">
                <span class="side-label">{{ t('memPatterns.whenLabel') }}</span>
                <span v-for="w in finding.view.when" :key="w" class="chip">{{ w }}</span>
                <span v-if="finding.view.when.length === 0" class="muted">{{ t('memPatterns.whenAlways') }}</span>
              </div>
              <Button variant="link" size="sm" class="raw-toggle" :aria-expanded="raw.has(finding.id)" @click="toggleRaw(finding.id)">
                {{ raw.has(finding.id) ? t('memPatterns.hideRawError') : t('memPatterns.rawError') }}
              </Button>
              <p v-if="raw.has(finding.id)" class="raw mono">{{ finding.view.rawError }}</p>

              <div v-if="finding.view.promptTrend.length > 0" class="trend" data-testid="mem-finding-trend">
                <span class="side-label">{{ t('memPatterns.trendLabel') }}</span>
                <template v-for="(point, i) in finding.view.promptTrend" :key="point.label">
                  <span v-if="i > 0" class="arrow" aria-hidden="true">→</span>
                  <span class="chip"><strong>{{ point.label }}</strong> {{ point.value }}</span>
                </template>
                <span class="muted small">{{ t('memPatterns.trendUnit') }}</span>
              </div>

              <div v-if="finding.view.canFix" class="fix">
                <Button variant="secondary" size="sm" :aria-expanded="fixOpen.has(finding.id)" data-testid="mem-finding-fix" @click="toggleFix(finding.id)">
                  {{ fixOpen.has(finding.id) ? t('memPatterns.hideFix') : t('memPatterns.proposeFix') }}
                </Button>
                <div v-if="fixOpen.has(finding.id)" class="fix-panel" data-testid="mem-finding-snippet">
                  <p class="muted small">{{ t('memPatterns.fixIntro') }}</p>
                  <pre class="code mono">{{ finding.snippet }}</pre>
                  <Button variant="link" size="sm" @click="copySnippet(finding.id, finding.snippet)">{{ copied === finding.id ? t('memPatterns.copied') : t('memPatterns.copy') }}</Button>
                </div>
              </div>
              <Button v-else-if="finding.view.watchWithAlert" variant="link" size="sm" class="raw-toggle" :to="{ name: 'alerts', params: { experimentId: route.params.experimentId } }">
                {{ t('memPatterns.watchAlert') }}
              </Button>
            </div>
            <div class="finding-side">
              <span class="rate">{{ formatPercent(finding.rate) }}</span>
              <div class="bar" role="img" :aria-label="finding.view.evidence"><span :style="{ width: Math.min(100, finding.rate * 100) + '%' }" /></div>
              <span class="muted small">{{ finding.view.evidence }}</span>
              <span class="muted small">{{ finding.view.liftText }}</span>
              <span class="side-label examples-label">{{ t('memPatterns.examples') }}</span>
              <router-link v-for="traceId in finding.examples" :key="traceId" :to="{ name: 'trace', params: { experimentId: route.params.experimentId, traceId } }" class="trace-link">{{ traceId.slice(0, 10) }}</router-link>
            </div>
          </article>
        </div>
      </Card>
    </template>
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 20px 24px 24px; background: var(--mt-soft-2); overflow: auto; }
.muted { color: var(--mt-muted); }
.mono { font-family: var(--mt-mono); }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.findings-card { overflow: hidden; }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 24px 16px; border-bottom: 1px solid var(--mt-line); }
.card-head h2 { margin: 0 0 4px; font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
.card-head p { margin: 0; }
.finding { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 32px; padding: 20px 24px; border-bottom: 1px solid var(--mt-line-2); }
.finding:last-child { border-bottom: 0; }
.finding-title { display: flex; align-items: center; gap: 8px; }
.headline { margin: 10px 0 4px; color: var(--mt-ink); font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.hint { margin: 0 0 12px; color: var(--mt-muted); font-size: 13.5px; line-height: 1.45; max-width: 62ch; }
.when { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chip { padding: 3px 10px; border-radius: var(--mt-radius-sm); background: var(--mt-soft); color: var(--mt-ink); font-size: 12.5px; }
.raw-toggle { margin-top: 8px; }
.raw { margin: 8px 0 0; padding: 8px 10px; border-radius: var(--mt-radius-sm); background: var(--mt-soft); color: var(--mt-muted); font-size: 12px; overflow-wrap: anywhere; }
.trend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
.arrow { color: var(--mt-muted); }
.fix { margin-top: 12px; }
.fix-panel { margin-top: 8px; padding: 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: var(--mt-soft); }
.fix-panel p { margin: 0 0 8px; }
.code { margin: 0 0 6px; overflow-x: auto; color: var(--mt-ink); font-size: 12.5px; line-height: 1.5; white-space: pre; }
.finding-side { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.rate { color: var(--mt-ink); font-size: 28px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
.bar { width: 100%; height: 6px; border-radius: 3px; background: var(--mt-soft); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--mt-err); }
.small { font-size: 12.5px; }
.examples-label { margin-top: 10px; }
.side-label { color: var(--mt-muted); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.trace-link { color: var(--mt-accent-text); font-family: var(--mt-mono); font-size: 12.5px; text-decoration: none; }
.trace-link:hover { text-decoration: underline; }
@media (max-width: 760px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .finding { grid-template-columns: 1fr; gap: 12px; } }
</style>
