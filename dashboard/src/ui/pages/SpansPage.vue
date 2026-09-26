<script setup lang="ts">
import type { ConversationSummaryDto, TraceDetailResponse, TraceSummaryDto } from "@contract";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { formatClock, formatCount, formatDuration, formatPercent } from "@/domain/format";
import { mergeLatestConversations } from "@/domain/merge";
import { RANGE_PRESETS, resolveRange } from "@/domain/time-range";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterPill, { type PillOption } from "../components/FilterPill.vue";
import LiveControl from "../components/LiveControl.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { setRefreshSeconds, useLiveRefresh } from "../composables/useLiveRefresh";
import { usePagedList } from "../composables/usePagedList";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 50;
const api = useTraceApi();
const router = useRouter();
const f = useFilters();

// ---- conversaciones (nivel 1) ----
const conversations = usePagedList<ConversationSummaryDto>({
  key: (c) => c.conversationId,
  load: (cursor, signal) => api.listConversations({ ...resolveRange(f.range.value, Date.now()), service: f.service.value, limit: PAGE_SIZE, cursor }, signal),
  merge: mergeLatestConversations,
  onLoaded: () => liveRefresh.touch(),
});

// ---- trazas de las conversaciones abiertas (nivel 2) ----
interface TraceChildren {
  items: TraceSummaryDto[];
  loading: boolean;
  error: Error | null;
}
const expandedConversations = ref<Set<string>>(new Set());
const conversationTraces = reactive<Record<string, TraceChildren>>({});

async function loadConversationTraces(id: string) {
  conversationTraces[id] ??= { items: [], loading: false, error: null };
  const entry = conversationTraces[id]!;
  entry.loading = true;
  entry.error = null;
  try {
    const detail = await api.getConversation(id);
    entry.items = detail.turns.items;
  } catch (e) {
    entry.error = e instanceof Error ? e : new Error(String(e));
  } finally {
    entry.loading = false;
  }
}

// ---- spans de las trazas abiertas (nivel 3) ----
interface SpanChildren {
  data: TraceDetailResponse | null;
  loading: boolean;
  error: Error | null;
}
const expandedTraces = ref<Set<string>>(new Set());
const traceSpans = reactive<Record<string, SpanChildren>>({});

async function loadTraceSpans(traceId: string) {
  traceSpans[traceId] ??= { data: null, loading: false, error: null };
  const entry = traceSpans[traceId]!;
  entry.loading = true;
  entry.error = null;
  try {
    entry.data = await api.getTrace(traceId);
  } catch (e) {
    entry.error = e instanceof Error ? e : new Error(String(e));
  } finally {
    entry.loading = false;
  }
}

function toggleConversation(id: string) {
  const next = new Set(expandedConversations.value);
  if (next.delete(id)) expandedConversations.value = next;
  else {
    next.add(id);
    expandedConversations.value = next;
    if (!conversationTraces[id]) void loadConversationTraces(id);
  }
}

function toggleTrace(traceId: string) {
  const next = new Set(expandedTraces.value);
  if (next.delete(traceId)) expandedTraces.value = next;
  else {
    next.add(traceId);
    expandedTraces.value = next;
    if (!traceSpans[traceId]) void loadTraceSpans(traceId);
  }
}

// ---- KPIs y opciones de filtro ----
const overview = useAsync((signal) => api.getOverview({ ...resolveRange(f.range.value, Date.now()), service: f.service.value }, signal));
const services = useAsync((signal) => api.listServices(resolveRange(f.range.value, Date.now()), signal));
const serviceOptions = computed<PillOption[]>(() => (services.data.value?.items ?? []).map((value) => ({ value, label: value })));

const kpis = computed(() => {
  const o = overview.data.value;
  if (!o) return [];
  return [
    { k: "Conversaciones", v: formatCount(o.totals.conversations), tone: "" },
    { k: "Spans", v: formatCount(o.totals.spans), tone: "" },
    { k: "Latencia p95", v: formatDuration(o.latencyMs.p95), tone: "" },
    { k: "Tasa de error", v: formatPercent(o.totals.errorRate), tone: o.totals.errorRate > 0 ? "bad" : "" },
    { k: "Tokens", v: formatCount(o.totals.totalTokens), tone: "" },
  ];
});

function reload() {
  void conversations.reload();
  void overview.run();
  void services.run();
  for (const id of expandedConversations.value) void loadConversationTraces(id);
}
const liveRefresh = useLiveRefresh(
  async () => {
    await Promise.all([conversations.refresh(), overview.run(), ...[...expandedConversations.value].map(loadConversationTraces)]);
  },
  { isBusy: () => conversations.loading.value || conversations.moreLoading.value },
);
watch([f.range, f.service], reload, { immediate: true });

// ---- búsqueda (con retardo para no lanzar una consulta por tecla) ----
const search = ref(f.text.value ?? "");
const searchInput = ref<HTMLInputElement | null>(null);
let debounce: ReturnType<typeof setTimeout> | null = null;
watch(search, (value) => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => f.setText(value), 300);
});
watch(f.text, (value) => {
  if ((value ?? "") !== search.value.trim()) search.value = value ?? "";
});
const onKey = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInput.value?.focus();
  }
};
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  if (debounce) clearTimeout(debounce);
});

const AGENT_CHIPS = [["#ede8ff", "#4a32c9"], ["#ffe9d9", "#b24a0a"], ["#ddf3fa", "#0b6f8c"], ["#ddf5f1", "#0b6b5d"]] as const;
const chipFor = (name: string | undefined) => {
  let h = 0;
  for (const ch of name ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AGENT_CHIPS[h % AGENT_CHIPS.length]!;
};
const convStatus = (c: ConversationSummaryDto) => (c.errorTurns > 0 ? "error" : c.failedSpans > 0 ? "warn" : "ok");
const STATUS_LABEL = { ok: "OK", error: "Error", warn: "Con fallos", unset: "–" } as const;

const openTrace = (traceId: string) => void router.push({ name: "trace", params: { traceId }, query: f.shared.value });

const footer = computed(() => {
  const n = conversations.items.value.length;
  return `${n} ${n === 1 ? "conversación" : "conversaciones"}${conversations.nextCursor.value ? " · hay más" : ""}`;
});
const rangeLabel = computed(() => RANGE_PRESETS.find((p) => p.key === f.range.value)!.long);
</script>

<template>
  <div class="page">
    <header class="top">
      <h1>Conversaciones</h1>
      <button type="button" class="range mt-card" :aria-label="`Rango de tiempo: ${rangeLabel}`">
        {{ rangeLabel }}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        <q-menu auto-close anchor="bottom right" self="top right" :offset="[0, 6]">
          <q-list dense style="min-width: 170px">
            <q-item v-for="p in RANGE_PRESETS" :key="p.key" clickable :active="p.key === f.range.value" @click="f.setRange(p.key)"><q-item-section>{{ p.long }}</q-item-section></q-item>
          </q-list>
        </q-menu>
      </button>
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
        <FilterPill label="Agente" :model-value="f.service.value" :options="serviceOptions" @update:model-value="(v) => f.setService(v ?? null)" />
      </div>

      <ErrorBanner v-if="conversations.error.value" :error="conversations.error.value" @retry="reload" />

      <div class="list">
        <template v-for="conv in conversations.items.value" :key="conv.conversationId">
          <!-- Nivel 1: Conversación -->
          <div class="item-group" :class="{ fresh: conversations.newKeys.value.has(conv.conversationId) }">
            <button
              type="button"
              class="item-header"
              @click="toggleConversation(conv.conversationId)"
              :aria-expanded="expandedConversations.has(conv.conversationId)"
              :aria-label="`Conversación ${conv.conversationId}`"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" :transform="expandedConversations.has(conv.conversationId) ? 'rotate(0)' : 'rotate(-90)'"><path d="M6 9l6 6 6-6" /></svg>
              <span class="chip" :style="{ background: chipFor(conv.serviceNames[0])[0] }">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" :stroke="chipFor(conv.serviceNames[0])[1]" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg>
              </span>
              <div class="item-info">
                <div class="item-title">{{ conv.conversationId }}</div>
                <div class="item-meta">{{ conv.serviceNames.join(", ") }} · {{ conv.turnCount }} {{ conv.turnCount === 1 ? "turno" : "turnos" }} · {{ formatDuration(conv.activeMs) }}</div>
              </div>
              <div class="item-status" :class="convStatus(conv)">{{ STATUS_LABEL[convStatus(conv)] }}</div>
            </button>

            <!-- Nivel 2: Trazas (turnos) de la conversación -->
            <div v-if="expandedConversations.has(conv.conversationId)" class="sublist">
              <div v-if="conversationTraces[conv.conversationId]?.loading && !conversationTraces[conv.conversationId]?.items.length" class="note">
                <q-spinner size="14px" color="primary" /> Cargando turnos…
              </div>
              <div v-else-if="conversationTraces[conv.conversationId]?.error" class="note err">
                No se pudieron cargar los turnos.
                <button type="button" class="link" @click="loadConversationTraces(conv.conversationId)">Reintentar</button>
              </div>
              <template v-else-if="conversationTraces[conv.conversationId]?.items">
                <template v-for="(trace, idx) in conversationTraces[conv.conversationId]!.items" :key="trace.traceId">
                  <!-- Nivel 2: Turno/Traza -->
                  <button
                    type="button"
                    class="item-subheader"
                    @click="toggleTrace(trace.traceId)"
                    :aria-expanded="expandedTraces.has(trace.traceId)"
                    :aria-label="`Turno ${idx + 1}`"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" :transform="expandedTraces.has(trace.traceId) ? 'rotate(0)' : 'rotate(-90)'"><path d="M6 9l6 6 6-6" /></svg>
                    <span class="turn-num">Turno {{ idx + 1 }}</span>
                    <span class="turn-time">{{ formatClock(trace.startTime, false) }}</span>
                    <span v-if="trace.totalTokens" class="turn-tokens">{{ formatCount(trace.totalTokens) }} tokens</span>
                  </button>

                  <!-- Nivel 3: Spans de la traza -->
                  <div v-if="expandedTraces.has(trace.traceId)" class="spans-list">
                    <div v-if="traceSpans[trace.traceId]?.loading && !traceSpans[trace.traceId]?.data" class="note">
                      <q-spinner size="14px" color="primary" /> Cargando spans…
                    </div>
                    <div v-else-if="traceSpans[trace.traceId]?.error" class="note err">
                      No se pudieron cargar los spans.
                      <button type="button" class="link" @click="loadTraceSpans(trace.traceId)">Reintentar</button>
                    </div>
                    <div v-else-if="traceSpans[trace.traceId]?.data?.roots" class="spans">
                      <div v-for="root in traceSpans[trace.traceId]!.data!.roots" :key="root.spanId" class="span-row" @click="openTrace(trace.traceId)">
                        <span class="span-name">{{ root.name }}</span>
                        <span class="span-duration">{{ formatDuration(root.durationMs) }}</span>
                        <span class="span-status" :class="root.status.code">{{ root.status.code === 'ok' ? '✓' : '✗' }}</span>
                      </div>
                    </div>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </template>

        <EmptyState v-if="!conversations.loading.value && conversations.items.value.length === 0 && !conversations.error.value" icon="forum" title="Todavía no hay conversaciones en este rango">
          Instrumenta tu agente con el SDK de MemTrace y envía trazas al endpoint OTLP.
        </EmptyState>
        <div v-if="conversations.loading.value && conversations.items.value.length === 0" class="spinner"><q-spinner size="28px" color="primary" /></div>
      </div>

      <ErrorBanner v-if="conversations.moreError.value" :error="conversations.moreError.value" @retry="conversations.loadMore" />
      <div class="footer">
        <span class="strong muted">{{ footer }}</span>
        <div class="footer-actions">
          <LiveControl :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />
          <button v-if="conversations.nextCursor.value" type="button" class="more" :disabled="conversations.moreLoading.value" @click="conversations.loadMore">
            {{ conversations.moreLoading.value ? "Cargando…" : "Cargar más" }}
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
  gap: 16px;
}
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 52px;
  flex-shrink: 0;
}
h1 {
  margin: 0 auto 0 8px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.range {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 20px;
  border: 0;
  border-radius: 26px;
  color: var(--mt-ink);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  flex-shrink: 0;
  border-radius: 24px;
}
.kpi {
  padding: 14px 22px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 1px solid var(--mt-line);
}
.kpi.first {
  border-left: 0;
}
.kpi-k {
  font-size: 12px;
  color: var(--mt-muted);
}
.kpi-v {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.03em;
}
.kpi-v.bad {
  color: #d0342c;
}
.kpi-msg {
  grid-column: 1 / -1;
  padding: 22px;
  color: var(--mt-muted);
}
.table-card {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
  padding: 20px 22px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
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
.item-group {
  border-bottom: 1px solid var(--mt-line);
}
.item-group.fresh {
  animation: fade-new 3s ease-out;
}
.item-header {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: #f6f9f7;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}
.item-header:hover {
  background: #eef4f0;
}
.item-header svg {
  flex-shrink: 0;
  transition: transform 0.2s;
}
.chip {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.item-info {
  flex: 1;
  min-width: 0;
}
.item-title {
  font-weight: 600;
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-meta {
  font-size: 11.5px;
  color: var(--mt-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-status {
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
}
.item-status.ok {
  background: #dff5e8;
  color: #0b6b5d;
}
.item-status.warn {
  background: #ffe9d9;
  color: #b24a0a;
}
.item-status.error {
  background: #ffe9e9;
  color: #d0342c;
}
.sublist {
  background: #fafbfa;
  border-left: 1px solid var(--mt-line);
}
.item-subheader {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 16px 10px 36px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  font-size: 13px;
}
.item-subheader:hover {
  background: rgba(0, 0, 0, 0.02);
}
.item-subheader svg {
  flex-shrink: 0;
  transition: transform 0.2s;
}
.turn-num {
  flex: 0 0 auto;
  font-weight: 500;
}
.turn-time {
  flex: 1;
  color: var(--mt-muted);
  font-size: 11px;
  font-family: monospace;
}
.turn-tokens {
  flex: 0 0 auto;
  color: var(--mt-muted);
  font-size: 11px;
}
.spans-list {
  background: white;
  padding: 8px 16px 8px 56px;
  border-top: 1px solid var(--mt-line-2);
}
.spans {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.span-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.span-row:hover {
  background: #f6f9f7;
}
.span-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.span-duration {
  flex: 0 0 auto;
  color: var(--mt-muted);
  font-family: monospace;
  font-size: 11px;
}
.span-status {
  flex: 0 0 auto;
  width: 20px;
  text-align: center;
  font-weight: 600;
}
.span-status.ok {
  color: #0b6b5d;
}
.span-status.error {
  color: #d0342c;
}
.note {
  padding: 10px 16px;
  color: var(--mt-muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.note.err {
  color: var(--mt-err-ink);
}
.link {
  border: 0;
  background: none;
  padding: 0;
  color: var(--mt-violet);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
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
  padding: 10px 8px 0;
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
  .item-group.fresh { animation: none; background: rgba(111, 207, 74, 0.16); }
}
</style>
