<script setup lang="ts">
import type { ConversationSummaryDto, TraceSummaryDto } from "@contract";
import { computed, inject, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import { formatCount, formatDateTime, formatDuration, formatPercent } from "@/domain/format";
import { mergeLatestConversations, mergeLatestTraces } from "@/domain/merge";
import { RANGE_PRESETS, resolveRange } from "@/domain/time-range";
import EmptyState from "../components/EmptyState.vue";
import OnboardingGuide from "../components/OnboardingGuide.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import PageHeader from "../components/PageHeader.vue";
import TraceTable from "../components/TraceTable.vue";
import Select from "../components/Select.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { setRefreshSeconds, useLiveRefresh } from "../composables/useLiveRefresh";
import { usePagedList } from "../composables/usePagedList";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 50;
const api = useTraceApi();
const router = useRouter();
const route = useRoute();
const experimentId = computed(() => route.params.experimentId as string);
const currentExperiment = inject(CURRENT_EXPERIMENT, computed(() => null));
const f = useFilters();
const grouped = computed(() => f.group.value === "conversation");

// Ungrouped (default): all traces. Grouped: one row per conversation.
const traces = usePagedList<TraceSummaryDto>({
  key: (t) => t.traceId,
  load: (cursor, signal) => api.listTraces({ ...resolveRange(f.range.value, Date.now()), service: f.service.value, hasErrors: f.hasErrors.value || undefined, minDurationMs: f.minDurationMs.value, limit: PAGE_SIZE, cursor }, signal),
  merge: mergeLatestTraces,
  onLoaded: () => liveRefresh.touch(),
});
const conversations = usePagedList<ConversationSummaryDto>({
  key: (c) => c.conversationId,
  load: (cursor, signal) => api.listConversations({ ...resolveRange(f.range.value, Date.now()), service: f.service.value, hasErrors: f.hasErrors.value || undefined, limit: PAGE_SIZE, cursor }, signal),
  merge: mergeLatestConversations,
  onLoaded: () => liveRefresh.touch(),
});
const active = computed(() => (grouped.value ? conversations : traces));

// ---- KPIs and filter options ----
const overview = useAsync((signal) => api.getOverview({ ...resolveRange(f.range.value, Date.now()), service: f.service.value }, signal));
const kpis = computed(() => {
  const o = overview.data.value;
  if (!o) return [];
  return [
    { k: "Conversations", v: formatCount(o.totals.conversations), tone: "" },
    { k: "Traces", v: formatCount(o.totals.traces), tone: "" },
    { k: "Latency p95", v: formatDuration(o.latencyMs.p95), tone: "" },
    { k: "Error Rate", v: formatPercent(o.totals.errorRate), tone: o.totals.errorRate > 0 ? "bad" : "" },
    { k: "Tokens", v: formatCount(o.totals.totalTokens), tone: "" },
  ];
});

function reload() {
  void active.value.reload();
  void overview.run();
}
const liveRefresh = useLiveRefresh(
  async () => {
    await Promise.all([active.value.refresh(), overview.run()]);
  },
  { isBusy: () => active.value.loading.value || active.value.moreLoading.value },
);
watch([f.range, f.service, f.hasErrors, f.minDurationMs, grouped], reload, { immediate: true });

const LATENCY_OPTIONS = [
  { label: "Any latency", value: 0 },
  { label: "≥ 1 s", value: 1000 },
  { label: "≥ 5 s", value: 5000 },
  { label: "≥ 10 s", value: 10000 },
  { label: "≥ 30 s", value: 30000 },
];

const convStatus = (c: ConversationSummaryDto) => (c.errorTurns > 0 ? "error" : c.failedSpans > 0 ? "warn" : "ok");
const STATUS_LABEL = { ok: "OK", error: "Error", warn: "With failures" } as const;

const openTrace = (traceId: string) => void router.push({ name: "trace", params: { experimentId: experimentId.value, traceId }, query: f.shared.value });
const openConversation = (conversationId: string) => void router.push({ name: "conversation", params: { experimentId: experimentId.value, conversationId }, query: f.shared.value });

const footer = computed(() => {
  const n = active.value.items.value.length;
  const noun = grouped.value ? (n === 1 ? "conversation" : "conversations") : n === 1 ? "trace" : "traces";
  return `${n} ${noun}${active.value.nextCursor.value ? " · more available" : ""}`;
});
const rangeLabel = computed(() => RANGE_PRESETS.find((p) => p.key === f.range.value)!.long);
const rangeOptions = computed(() => RANGE_PRESETS.map((p) => ({ label: p.long, value: p.key })));
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="[{ label: 'MemTrace', to: { name: 'conversations', params: { experimentId } } }, { label: 'Conversations' }]" icon="M4 5h16v11H9l-5 4z" title="Conversations">
      <FilterBar :range="f.range.value" :loading="overview.loading.value" @update:range="f.setRange" @refresh="reload">
        <LiveControl :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />
      </FilterBar>
    </PageHeader>

    <section class="kpis mt-card" aria-label="Summary">
      <template v-if="kpis.length">
        <div v-for="(k, i) in kpis" :key="k.k" class="kpi" :class="{ first: i === 0 }">
          <span class="kpi-k">{{ k.k }}</span>
          <span class="kpi-v" :class="k.tone">{{ k.v }}</span>
        </div>
      </template>
      <div v-else-if="overview.error.value" class="kpi-msg">Could not load summary.</div>
      <div v-else class="kpi-msg">Loading summary…</div>
    </section>

    <section class="table-card mt-card">
      <div class="toolbar">
        <q-toggle :model-value="f.hasErrors.value" label="Only with errors" dense @update:model-value="(v: boolean) => f.setHasErrors(v)" />
        <Select
          v-if="!grouped"
          class="latency"
          :model-value="f.minDurationMs.value ?? 0"
          :options="LATENCY_OPTIONS"
          placeholder="Latency"
          @update:model-value="(v: number) => f.setMinDuration(v || undefined)"
        />
        <q-toggle class="group-toggle" :model-value="grouped" label="Group by conversation" dense @update:model-value="(v: boolean) => f.setGroup(v ? 'conversation' : 'flat')" />
      </div>

      <ErrorBanner v-if="active.error.value" :error="active.error.value" @retry="reload" />

      <div class="list">
        <table v-if="grouped && conversations.items.value.length" class="conversations">
          <thead>
            <tr><th>Conversation</th><th>Agent</th><th>Last Activity</th><th class="num">Turns</th><th class="num">Active Time</th><th class="num">Tokens</th><th>Status</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in conversations.items.value" :key="c.conversationId" class="item" :class="{ fresh: conversations.newKeys.value.has(c.conversationId) }" tabindex="0" @click="openConversation(c.conversationId)" @keydown.enter="openConversation(c.conversationId)">
              <td class="name mono" :title="c.conversationId">{{ c.conversationId }}</td>
              <td class="muted">{{ c.serviceNames.join(", ") }}</td>
              <td class="muted mono">{{ formatDateTime(c.lastActivity) }}</td>
              <td class="num mono">{{ c.turnCount }}</td>
              <td class="num mono">{{ formatDuration(c.activeMs) }}</td>
              <td class="num mono">{{ c.totalTokens ? formatCount(c.totalTokens) : "–" }}</td>
              <td><span class="status" :class="convStatus(c)">{{ STATUS_LABEL[convStatus(c)] }}</span></td>
            </tr>
          </tbody>
        </table>
        <TraceTable v-else-if="!grouped && traces.items.value.length" :items="traces.items.value" :new-keys="traces.newKeys.value" show-conversation @open="openTrace" @open-conversation="openConversation" />

        <OnboardingGuide
          v-if="!active.loading.value && active.items.value.length === 0 && !active.error.value"
          :service-name="currentExperiment?.serviceName ?? ''"
          :experiment-id="experimentId"
        />
        <div v-if="active.loading.value && active.items.value.length === 0" class="spinner"><q-spinner size="28px" color="primary" /></div>
      </div>

      <ErrorBanner v-if="active.moreError.value" :error="active.moreError.value" @retry="active.loadMore" />
      <div class="footer">
        <div class="footer-actions">
          <button v-if="active.nextCursor.value" type="button" class="more" :disabled="active.moreLoading.value" @click="active.loadMore">
            {{ active.moreLoading.value ? "Loading…" : "Load more" }}
          </button>
        </div>
      </div>
    </section>
  </q-page>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 24px 20px 32px;
  font-family: var(--mt-sans);
  background: var(--mt-card);
  border-radius: var(--mt-radius-lg);
  box-shadow: var(--mt-shadow);
}
.range {
  height: 34px;
  font-size: 13px;
  font-weight: 600;
}
.range :deep(.select-trigger) {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  color: var(--mt-ink);
  font-weight: 600;
}
.range :deep(.select-trigger:hover) {
  background: rgba(127, 207, 74, 0.12);
  border-color: transparent;
}
.range :deep(.select-trigger.active) {
  color: var(--mt-ink);
}
.kpis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  flex-shrink: 0;
  border-radius: var(--mt-radius-lg);
}
.kpi {
  padding: 7px 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
  border-left: 1px solid var(--mt-line);
}
.kpi.first {
  border-left: 0;
}
.kpi-k {
  font-size: 11px;
  color: var(--mt-muted);
}
.kpi-v {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.kpi-v.bad {
  color: #d0342c;
}
.kpi-msg {
  grid-column: 1 / -1;
  padding: 12px 16px;
  color: var(--mt-muted);
}
.table-card {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 12px 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}
.latency {
  min-width: 170px;
}
.group-toggle {
  margin-left: auto;
  font-weight: 600;
}
.muted {
  color: var(--mt-muted);
}
.strong {
  font-weight: 500;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.conversations {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  background: var(--mt-card, #fff);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.num {
  text-align: right;
}
.item {
  cursor: pointer;
}
.item:hover,
.item:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.item.fresh {
  animation: fade-new 3s ease-out;
}
.name {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.status {
  padding: 3px 8px;
  border-radius: var(--mt-radius-sm);
  font-size: 11px;
  font-weight: 500;
}
.status.ok {
  background: #dff5e8;
  color: #0b6b5d;
}
.status.warn {
  background: #ffe9d9;
  color: #b24a0a;
}
.status.error {
  background: #ffe9e9;
  color: #d0342c;
}
.spinner {
  display: flex;
  justify-content: center;
  padding: 40px;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 8px 0;
  border-top: 1px solid var(--mt-line);
  flex-shrink: 0;
}
.footer-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.more {
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.more:disabled {
  opacity: 0.6;
}
@keyframes fade-new {
  from { background: rgba(111, 207, 74, 0.3); }
}
@media (prefers-reduced-motion: reduce) {
  .item.fresh { animation: none; background: rgba(111, 207, 74, 0.16); }
}
</style>
