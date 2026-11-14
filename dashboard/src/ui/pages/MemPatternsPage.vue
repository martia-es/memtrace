<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";
import { useAsync } from "../composables/useAsync";
import PageHeader from "../components/PageHeader.vue";
import Card from "../components/Card.vue";
import KpiCard from "../components/KpiCard.vue";
import Pill from "../components/Pill.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import LoadingState from "../components/LoadingState.vue";
import { formatCount, formatPercent } from "@/domain/format";
import { t } from "../i18n";

const api = useTraceApi();
const route = useRoute();
const filters = useFilters();
const patterns = useAsync((signal) => api.getMemPatterns(filters.resolve(), signal));
watch(filters.rangeSig, () => void patterns.run(), { immediate: true });

const data = computed(() => patterns.data.value);
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
          <article v-for="finding in data.findings" :key="finding.findingId" class="finding" data-testid="mem-finding">
            <div class="finding-main">
              <div class="finding-title"><strong>{{ finding.cause }}</strong><Pill tone="warn">{{ formatPercent(finding.failureRate) }}</Pill></div>
              <p class="rule mono">{{ finding.rule }}</p>
              <p class="muted evidence">{{ t('memPatterns.evidence', { failures: formatCount(finding.failures), support: formatCount(finding.support), lift: finding.lift.toFixed(2) }) }}</p>
            </div>
            <div class="finding-side">
              <span class="side-label">{{ t('memPatterns.examples') }}</span>
              <router-link v-for="traceId in finding.exampleTraceIds" :key="traceId" :to="{ name: 'trace', params: { experimentId: route.params.experimentId, traceId } }" class="trace-link">{{ traceId.slice(0, 10) }}</router-link>
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
.finding { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 24px; padding: 16px 24px; border-bottom: 1px solid var(--mt-line-2); }
.finding:last-child { border-bottom: 0; }
.finding-title { display: flex; align-items: center; gap: 10px; }
.finding-title strong { color: var(--mt-ink); font-size: 15px; font-weight: 700; }
.rule { margin: 8px 0 4px; padding: 6px 10px; border-radius: var(--mt-radius-sm); background: var(--mt-soft); color: var(--mt-ink); font-size: 12.5px; width: fit-content; max-width: 100%; }
.evidence { margin: 0; font-size: 12.5px; }
.finding-side { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
.side-label { color: var(--mt-muted); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.trace-link { color: var(--mt-accent-text); font-family: var(--mt-mono); font-size: 12.5px; text-decoration: none; }
.trace-link:hover { text-decoration: underline; }
@media (max-width: 760px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .finding { grid-template-columns: 1fr; gap: 12px; } }
</style>
