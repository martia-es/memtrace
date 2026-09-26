<script setup lang="ts">
import type { ConversationSummaryDto, TraceSummaryDto } from "@contract";
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { formatCount, formatDateTime, formatDuration, formatPercent } from "@/domain/format";
import { mergeLatestConversations, mergeLatestTraces } from "@/domain/merge";
import { RANGE_PRESETS, resolveRange } from "@/domain/time-range";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import LiveControl from "../components/LiveControl.vue";
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
const f = useFilters();
const grouped = computed(() => f.group.value === "conversation");

// Sin agrupar (por defecto): todas las trazas. Agrupado: una fila por conversación.
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

// ---- KPIs y opciones de filtro ----
const overview = useAsync((signal) => api.getOverview({ ...resolveRange(f.range.value, Date.now()), service: f.service.value }, signal));
const kpis = computed(() => {
  const o = overview.data.value;
  if (!o) return [];
  return [
    { k: "Conversaciones", v: formatCount(o.totals.conversations), tone: "" },
    { k: "Trazas", v: formatCount(o.totals.traces), tone: "" },
    { k: "Latencia p95", v: formatDuration(o.latencyMs.p95), tone: "" },
    { k: "Tasa de error", v: formatPercent(o.totals.errorRate), tone: o.totals.errorRate > 0 ? "bad" : "" },
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
  { label: "Cualquier latencia", value: 0 },
  { label: "≥ 1 s", value: 1000 },
  { label: "≥ 5 s", value: 5000 },
  { label: "≥ 10 s", value: 10000 },
  { label: "≥ 30 s", value: 30000 },
];

const convStatus = (c: ConversationSummaryDto) => (c.errorTurns > 0 ? "error" : c.failedSpans > 0 ? "warn" : "ok");
const STATUS_LABEL = { ok: "OK", error: "Error", warn: "Con fallos" } as const;

const openTrace = (traceId: string) => void router.push({ name: "trace", params: { traceId }, query: f.shared.value });
const openConversation = (conversationId: string) => void router.push({ name: "conversation", params: { conversationId }, query: f.shared.value });

const footer = computed(() => {
  const n = active.value.items.value.length;
  const noun = grouped.value ? (n === 1 ? "conversación" : "conversaciones") : n === 1 ? "traza" : "trazas";
  return `${n} ${noun}${active.value.nextCursor.value ? " · hay más" : ""}`;
});
const rangeLabel = computed(() => RANGE_PRESETS.find((p) => p.key === f.range.value)!.long);
const rangeOptions = computed(() => RANGE_PRESETS.map((p) => ({ label: p.long, value: p.key })));
</script>

<template>
  <div class="page">
    <header class="top">
      <h1>Conversaciones</h1>
      <Select
        class="range mt-card"
        :model-value="f.range.value"
        :options="rangeOptions"
        :aria-label="`Rango de tiempo: ${rangeLabel}`"
        @update:model-value="f.setRange"
      />
    </header>

    <section class="kpis mt-card" aria-label="Resumen">
      <template v-if="kpis.length">
        <div v-for="(k, i) in kpis" :key="k.k" class="kpi" :class="{ first: i === 0 }">
          <span class="kpi-k">{{ k.k }}</span>
          <span class="kpi-v" :class="k.tone">{{ k.v }}</span>
        </div>
      </template>
      <div v-else-if="overview.error.value" class="kpi-msg">No se pudo cargar el resumen.</div>
      <div v-else class="kpi-msg">Cargando resumen…</div>
    </section>

    <section class="table-card mt-card">
      <div class="toolbar">
        <q-toggle :model-value="f.hasErrors.value" label="Solo con errores" dense @update:model-value="(v: boolean) => f.setHasErrors(v)" />
        <Select
          v-if="!grouped"
          class="latency"
          :model-value="f.minDurationMs.value ?? 0"
          :options="LATENCY_OPTIONS"
          placeholder="Latencia"
          @update:model-value="(v: number) => f.setMinDuration(v || undefined)"
        />
        <q-toggle class="group-toggle" :model-value="grouped" label="Agrupar por conversación" dense @update:model-value="(v: boolean) => f.setGroup(v ? 'conversation' : 'flat')" />
      </div>

      <ErrorBanner v-if="active.error.value" :error="active.error.value" @retry="reload" />

      <div class="list">
        <table v-if="grouped && conversations.items.value.length" class="conversations">
          <thead>
            <tr><th>Conversación</th><th>Agente</th><th>Última actividad</th><th class="num">Turnos</th><th class="num">Tiempo activo</th><th class="num">Tokens</th><th>Estado</th></tr>
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

        <EmptyState v-if="!active.loading.value && active.items.value.length === 0 && !active.error.value" icon="forum" :title="grouped ? 'Todavía no hay conversaciones en este rango' : 'Todavía no hay trazas en este rango'">
          Instrumenta tu agente con el SDK de MemTrace y envía trazas al endpoint OTLP.
        </EmptyState>
        <div v-if="active.loading.value && active.items.value.length === 0" class="spinner"><q-spinner size="28px" color="primary" /></div>
      </div>

      <ErrorBanner v-if="active.moreError.value" :error="active.moreError.value" @retry="active.loadMore" />
      <div class="footer">
        <span class="strong muted">{{ footer }}</span>
        <div class="footer-actions">
          <LiveControl :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />
          <button v-if="active.nextCursor.value" type="button" class="more" :disabled="active.moreLoading.value" @click="active.loadMore">
            {{ active.moreLoading.value ? "Cargando…" : "Cargar más" }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 36px;
  flex-shrink: 0;
}
h1 {
  margin: 0 auto 0 8px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
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
  border-radius: 17px;
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
  border-radius: 18px;
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
  border-radius: 6px;
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
  border: 1px solid #e3eae5;
  border-radius: 17px;
  background: #fff;
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
