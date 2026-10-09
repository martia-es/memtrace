<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../components/Select.vue";
import type { ConversationSummaryDto, TraceSummaryDto } from "@contract";
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import { formatCostUsd, formatCount, formatDateTime, formatDuration, formatPercent, formatRelativeTime, shortRevision } from "@/domain/format";
import { mergeLatestConversations, mergeLatestTraces } from "@/domain/merge";
import EmptyState from "../components/EmptyState.vue";
import OnboardingGuide from "../components/OnboardingGuide.vue";
import ConversationPreview from "../components/ConversationPreview.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import AnnotationChip from "../components/AnnotationChip.vue";
import FeedbackChip from "../components/FeedbackChip.vue";
import AddToDatasetModal from "../components/AddToDatasetModal.vue";
import AddToQueueModal from "../components/AddToQueueModal.vue";
import Modal from "../components/Modal.vue";
import TraceAnnotationsPanel from "../components/TraceAnnotationsPanel.vue";
import StatusChip from "../components/StatusChip.vue";
import PageHeader from "../components/PageHeader.vue";
import TraceTable from "../components/TraceTable.vue";
import PromptChips from "../components/PromptChips.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useLiveRefresh } from "../composables/useLiveRefresh";
import { usePagedList } from "../composables/usePagedList";
import { useTraceApi } from "../composables/useTraceApi";
import { useExperimentRepo } from "../composables/useExperimentRepo";
import DataTable from "../components/DataTable.vue";

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
  load: (cursor, signal) => api.listTraces({ ...f.resolve(), service: f.service.value, hasErrors: f.hasErrors.value || undefined, minDurationMs: f.minDurationMs.value, text: f.text.value, revision: f.revision.value, promptName: f.prompt.value, promptVersion: f.promptVersion.value, limit: PAGE_SIZE, cursor }, signal),
  merge: mergeLatestTraces,
  onLoaded: () => liveRefresh.touch(),
});
const conversations = usePagedList<ConversationSummaryDto>({
  key: (c) => c.conversationId,
  load: (cursor, signal) => api.listConversations({ ...f.resolve(), service: f.service.value, hasErrors: f.hasErrors.value || undefined, text: f.text.value, revision: f.revision.value, promptName: f.prompt.value, promptVersion: f.promptVersion.value, limit: PAGE_SIZE, cursor }, signal),
  merge: mergeLatestConversations,
  onLoaded: () => liveRefresh.touch(),
});
const active = computed(() => (grouped.value ? conversations : traces));

// ---- KPIs and filter options ----
const overview = useAsync((signal) => api.getOverview({ ...f.resolve(), service: f.service.value }, signal));
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
watch([f.rangeSig, f.service, f.hasErrors, f.minDurationMs, f.text, f.revision, f.prompt, f.promptVersion, grouped], reload, { immediate: true });

const convStatus = (c: ConversationSummaryDto) => (c.errorTurns > 0 ? "error" : c.failedSpans > 0 ? "warn" : "ok");
/** barra de color a la izquierda de la fila (diseño): error y valoración baja destacan; con fallos internos, aviso */
const rowBar = (c: ConversationSummaryDto) => (convStatus(c) === "error" ? "bar-error" : ratings.value.get(c.conversationId)?.low ? "bar-low" : convStatus(c) === "warn" ? "bar-warn" : "");
const STATUS_LABEL = { ok: "OK", error: "Error", warn: "With failures" } as const;

// ---- columna Annotation: etiquetas humanas de las filas cargadas (se piden por lote, solo las que faltan) ----
const ratings = ref(new Map<string, { labels: number; low: boolean }>());
const feedback = ref(new Map<string, { up: number; down: number }>());
const rated = new Set<string>();
const ratingIds = computed(() => (grouped.value ? conversations.items.value.map((c) => c.conversationId) : traces.items.value.map((t) => t.traceId)));
async function loadRatings(ids: string[]) {
  const missing = ids.filter((id) => !rated.has(id));
  if (missing.length === 0) return;
  missing.forEach((id) => rated.add(id));
  try {
    const { items } = await api.getAnnotationRatings(grouped.value ? { conversationIds: missing } : { traceIds: missing });
    ratings.value = new Map([...ratings.value, ...items.map((r) => [r.id, r] as const)]);
  } catch {
    missing.forEach((id) => rated.delete(id)); // sin dato la columna muestra "–"; se reintenta en la próxima carga
  }
  // 👍/👎 de usuario final (ADR-062): carga aparte, si falla solo se omite su columna
  try {
    const { items } = await api.getFeedbackRatings(grouped.value ? { conversationIds: missing } : { traceIds: missing });
    feedback.value = new Map([...feedback.value, ...items.map((r) => [r.id, r] as const)]);
  } catch {
    /* sin dato la columna muestra "–" */
  }
}
watch([ratingIds, grouped], ([ids]) => void loadRatings(ids));
/** Tras anotar desde la vista previa, la fila seleccionada se vuelve a pedir para que la columna refleje la etiqueta nueva. */
function closeAnnotate() {
  annotating.value = false;
  if (selected.value) {
    rated.delete(selected.value.id);
    void loadRatings([selected.value.id]);
  }
}
watch([f.rangeSig, f.service], () => {
  rated.clear();
  ratings.value = new Map();
});

// ---- búsqueda por texto de entrada / salida (se aplica tras una pausa al teclear) ----
const search = ref(f.text.value ?? "");
watch(f.text, (v) => (search.value = v ?? ""));
let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, (v) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => f.setText(v ?? ""), 400);
});
onBeforeUnmount(() => clearTimeout(searchTimer));

// ---- versión del código (ADR-065): SHA completo o prefijo ----
// se elige entre los commits que han generado trazas en el rango (con cuántas), en vez de teclear el hash
const revisions = useAsync((signal) => api.listRevisions(f.resolve(), signal));
watch([f.rangeSig, f.service], () => void revisions.run(), { immediate: true });
const versionOptions = computed(() => {
  const found = revisions.data.value?.items ?? [];
  const options = [{ label: "All versions", value: "" }, ...found.map((r) => ({ label: `${shortRevision(r.revision)} · ${r.traces} ${r.traces === 1 ? "trace" : "traces"} · ${formatRelativeTime(r.lastSeen, Date.now())}`, value: r.revision }))];
  const current = f.revision.value;
  // un filtro que llega por la URL y no está en el rango sigue visible y se puede quitar
  if (current && !found.some((r) => r.revision.startsWith(current.toLowerCase()))) options.splice(1, 0, { label: `${shortRevision(current)} (not in this range)`, value: current });
  return options;
});
const selectedVersion = computed(() => versionOptions.value.find((o) => o.value && f.revision.value && (o.value.startsWith(f.revision.value.toLowerCase()) || f.revision.value.toLowerCase().startsWith(o.value)))?.value ?? "");
const repo = useExperimentRepo(experimentId);

// ---- vistas rápidas (ADR-048): atajos a los filtros que más se usan ----
const SLOW_MS = 5000;
const quick = computed<"all" | "errors" | "slow">(() => (f.hasErrors.value ? "errors" : (f.minDurationMs.value ?? 0) >= SLOW_MS ? "slow" : "all"));
const quickViews = computed(() => {
  const errors = overview.data.value?.totals.errorTraces;
  return [
    { key: "all" as const, label: "All", count: null },
    { key: "errors" as const, label: "With errors", count: errors ?? null },
    ...(grouped.value ? [] : [{ key: "slow" as const, label: `Slow (≥ ${SLOW_MS / 1000} s)`, count: null }]),
  ];
});

// ---- vista previa: un clic selecciona, doble clic o Enter abre el detalle ----
const selected = ref<{ kind: "conversation" | "trace"; id: string } | null>(null);
watch([grouped, f.rangeSig, f.service, f.hasErrors, f.minDurationMs, f.text, f.revision, f.prompt, f.promptVersion], () => (selected.value = null));
const transcript = useAsync((signal) => api.getTranscript(selected.value!.id, signal));
watch(selected, (s) => {
  if (s?.kind === "conversation") void transcript.run();
});
const selectedConversation = computed(() => (selected.value?.kind === "conversation" ? conversations.items.value.find((c) => c.conversationId === selected.value!.id) ?? null : null));
const selectedTrace = computed(() => (selected.value?.kind === "trace" ? traces.items.value.find((t) => t.traceId === selected.value!.id) ?? null : null));
const preview = computed(() => {
  const c = selectedConversation.value;
  if (c) {
    const turns = transcript.data.value?.turns ?? [];
    const messages = turns.flatMap((t) => [
      ...(t.user ? [{ role: "user" as const, text: t.user }] : []),
      ...(t.assistant ? [{ role: "assistant" as const, text: t.assistant, traceId: t.traceId }] : []),
    ]);
    return {
      title: c.title ?? c.conversationId,
      subtitle: `${c.conversationId} · ${c.serviceNames.join(", ")} · ${formatDateTime(c.lastActivity)}`,
      stats: [
        { k: "TURNS", v: String(c.turnCount) },
        { k: "ACTIVE TIME", v: formatDuration(c.activeMs) },
        { k: "COST", v: formatCostUsd(c.costUsd) ?? "–" },
      ],
      messages,
      loading: transcript.loading.value && !transcript.data.value,
      emptyHint: transcript.data.value && !transcript.data.value.contentCaptured ? "The agent did not capture message content (enable MEMTRACE_CAPTURE_CONTENT=true to see it here)." : undefined,
    };
  }
  const t = selectedTrace.value;
  if (t) {
    return {
      title: t.rootSpanName,
      subtitle: t.traceId,
      stats: [
        { k: "DURATION", v: formatDuration(t.durationMs) },
        { k: "TOKENS", v: t.totalTokens ? formatCount(t.totalTokens) : "–" },
        { k: "SPANS", v: formatCount(t.spanCount) },
      ],
      messages: [...(t.input ? [{ role: "user" as const, text: t.input }] : []), ...(t.output ? [{ role: "assistant" as const, text: t.output, traceId: t.traceId }] : [])],
      loading: false,
      emptyHint: undefined,
    };
  }
  return null;
});
// ---- acciones de la vista previa: actúan sobre la traza seleccionada o, en una conversación, sobre su último turno ----
const actionTraceId = computed(() => (selected.value?.kind === "trace" ? selected.value.id : transcript.data.value?.turns.at(-1)?.traceId ?? null));
const annotating = ref(false);
const addingToQueue = ref(false);
const addingToDataset = ref(false);
const datasetTrace = useAsync((signal) => api.getTrace(actionTraceId.value!, signal));
const startAddToDataset = () => {
  addingToDataset.value = true;
  void datasetTrace.run();
};
const openSelected = () => {
  if (!selected.value) return;
  if (selected.value.kind === "conversation") openConversation(selected.value.id);
  else openTrace(selected.value.id);
};

const openTrace = (traceId: string) => void router.push({ name: "trace", params: { experimentId: experimentId.value, traceId }, query: f.shared.value });
const openConversation = (conversationId: string) => void router.push({ name: "conversation", params: { experimentId: experimentId.value, conversationId }, query: f.shared.value });

const footer = computed(() => {
  const n = active.value.items.value.length;
  const noun = grouped.value ? (n === 1 ? "conversation" : "conversations") : n === 1 ? "trace" : "traces";
  return `${n} ${noun}${active.value.nextCursor.value ? " · more available" : ""}`;
});
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="[{ label: 'MemTrace', to: { name: 'overview', params: { experimentId } } }, { label: 'Conversations' }]" icon="M4 5h16v11H9l-5 4z" title="Conversations" />

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

    <div class="views-row">
      <div class="mt-segmented small" role="group" aria-label="List mode">
        <button type="button" class="mode-conversations" :aria-pressed="grouped" @click="f.setGroup('conversation')">Conversations</button>
        <button type="button" class="mode-traces" :aria-pressed="!grouped" @click="f.setGroup('flat')">Traces</button>
      </div>
      <div class="quick-tabs" role="tablist" aria-label="Quick views">
        <button v-for="v in quickViews" :key="v.key" type="button" role="tab" class="quick" :class="{ active: quick === v.key }" :aria-selected="quick === v.key" @click="f.setQuickView(v.key)">
          {{ v.label }}<span v-if="v.count !== null" class="quick-count mono">{{ v.count }}</span>
        </button>
      </div>
      <button v-if="f.prompt.value" type="button" class="prompt-filter" data-testid="prompt-filter" :title="'Remove the prompt filter'" @click="f.setPrompt(undefined)">
        Prompt: <b>{{ f.prompt.value }}{{ f.promptVersion.value ? ` v${f.promptVersion.value}` : "" }}</b> ✕
      </button>
      <Select :model-value="selectedVersion" :options="versionOptions" :loading="revisions.loading.value" class="version" aria-label="Filter by code version" data-testid="revision-filter" @update:model-value="(v: string) => f.setRevision(v)" />
      <TextInput type="search" v-model="search" placeholder="Search input / output…" class="search" aria-label="Search input and output" />
    </div>

    <div class="body">
      <section class="table-card mt-card">
        <ErrorBanner v-if="active.error.value" :error="active.error.value" @retry="reload" />

        <div class="list">
          <DataTable v-if="grouped && conversations.items.value.length" class="conversations" sticky nowrap>
            <thead>
              <tr><th>Conversation</th><th>Prompt</th><th>Last activity</th><th class="num">Turns</th><th class="num">Active time</th><th class="num">Tokens</th><th class="num">Cost</th><th>Status</th><th>Annotation</th><th>User feedback</th></tr>
            </thead>
            <tbody>
              <tr
                v-for="c in conversations.items.value"
                :key="c.conversationId"
                class="item"
                :class="[{ fresh: conversations.newKeys.value.has(c.conversationId), selected: selected?.id === c.conversationId }, rowBar(c)]"
                tabindex="0"
                @click="selected = { kind: 'conversation', id: c.conversationId }"
                @dblclick="openConversation(c.conversationId)"
                @keydown.enter="openConversation(c.conversationId)"
              >
                <td class="name-cell">
                  <span class="name" :class="{ mono: !c.title }" :title="c.title ?? c.conversationId">{{ c.title ?? c.conversationId }}</span>
                  <span class="sub"><span v-if="c.title" class="mono">{{ c.conversationId }} · </span>{{ c.serviceNames.join(", ") }}</span>
                </td>
                <td><PromptChips :prompts="c.prompts" :max="2" /></td>
                <td class="muted mono">{{ formatDateTime(c.lastActivity) }}</td>
                <td class="num mono">{{ c.turnCount }}</td>
                <td class="num mono">{{ formatDuration(c.activeMs) }}</td>
                <td class="num mono">{{ c.totalTokens ? formatCount(c.totalTokens) : "–" }}</td>
                <td class="num mono">{{ formatCostUsd(c.costUsd) ?? "–" }}</td>
                <td><StatusChip :tone="convStatus(c)" :label="STATUS_LABEL[convStatus(c)]" /></td>
                <td><AnnotationChip :rating="ratings.get(c.conversationId)" /></td>
                <td><FeedbackChip :feedback="feedback.get(c.conversationId)" /></td>
              </tr>
            </tbody>
          </DataTable>
          <TraceTable
            v-else-if="!grouped && traces.items.value.length"
            :items="traces.items.value"
            :new-keys="traces.newKeys.value"
            :selected-id="selected?.kind === 'trace' ? selected.id : null"
            :ratings="ratings"
            :feedback="feedback"
            :repo="repo"
            selectable
            show-conversation
            show-prompts
            @select="(id: string) => (selected = { kind: 'trace', id })"
            @open="openTrace"
            @open-conversation="openConversation"
          />

          <div v-if="!active.loading.value && active.items.value.length === 0 && !active.error.value && f.text.value" class="no-match">No matches for “{{ f.text.value }}” in this range.</div>
          <OnboardingGuide
            v-else-if="!active.loading.value && active.items.value.length === 0 && !active.error.value"
            :service-name="currentExperiment?.serviceName ?? ''"
            :experiment-id="experimentId"
          />
          <div v-if="active.loading.value && active.items.value.length === 0" class="spinner"><q-spinner size="28px" color="primary" /></div>
        </div>

        <ErrorBanner v-if="active.moreError.value" :error="active.moreError.value" @retry="active.loadMore" />
        <div class="footer">
          <span class="count">{{ footer }}</span>
          <button v-if="active.nextCursor.value" type="button" class="more" :disabled="active.moreLoading.value" @click="active.loadMore">
            {{ active.moreLoading.value ? "Loading…" : "Load more" }}
          </button>
        </div>
      </section>

      <ConversationPreview
        v-if="preview"
        :title="preview.title"
        :subtitle="preview.subtitle"
        :stats="preview.stats"
        :messages="preview.messages"
        :loading="preview.loading"
        :empty-hint="preview.emptyHint"
        show-actions
        :actions-disabled="!actionTraceId"
        :actions-hint="selected?.kind === 'conversation' ? 'Acts on the latest turn of the conversation' : undefined"
        @open="openSelected"
        @close="selected = null"
        @annotate="annotating = true"
        @add-to-queue="addingToQueue = true"
        @add-to-dataset="startAddToDataset"
      />

      <template v-if="actionTraceId">
        <AddToQueueModal v-if="addingToQueue" :trace-id="actionTraceId" @close="addingToQueue = false" />
        <AddToDatasetModal v-if="addingToDataset && datasetTrace.data.value" :trace-id="actionTraceId" :roots="datasetTrace.data.value.roots" @close="addingToDataset = false" />
        <Modal v-if="annotating" title="Annotate trace" wide @close="closeAnnotate">
          <TraceAnnotationsPanel :trace-id="actionTraceId" :experiment-id="experimentId" :span="null" />
        </Modal>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.prompt-filter {
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--mt-line);
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.page {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 20px 24px 20px;
  font-family: var(--mt-sans);
  background: var(--mt-bg);
}
.kpis {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  flex-shrink: 0;
}
.kpi {
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-left: 1px solid var(--mt-line-2);
}
.kpi.first {
  border-left: 0;
}
.kpi-k {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.kpi-v {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.kpi-v.bad {
  color: var(--mt-err-ink);
}
.kpi-msg {
  grid-column: 1 / -1;
  padding: 12px 16px;
  color: var(--mt-muted);
}
.views-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--mt-line);
}
.views-row .mt-segmented {
  margin-bottom: 6px;
}
.version { width: 260px; }
.search {
  margin: 0 0 6px auto;
  width: 280px;
}
.quick-tabs {
  display: flex;
  gap: 4px;
  align-self: flex-end;
}
.quick {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 10px;
  margin-bottom: -1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--mt-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.quick.active {
  color: var(--mt-ink);
  border-bottom-color: var(--mt-accent);
}
.quick-count {
  padding: 0 5px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}
.table-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.muted {
  color: var(--mt-muted);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.num {
  text-align: right;
}
.mono {
  font-size: 12px;
  font-weight: 400;
}
.item {
  cursor: pointer;
}
.item:hover,
.item:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.item.selected {
  background: var(--mt-accent-tint);
  box-shadow: inset 3px 0 0 var(--mt-accent);
}
.item.bar-error { box-shadow: inset 3px 0 0 var(--mt-err); }
.item.bar-low { box-shadow: inset 3px 0 0 var(--mt-highlight); }
.item.bar-warn { box-shadow: inset 3px 0 0 var(--mt-warn); }
.item.fresh {
  animation: fade-new 3s ease-out;
}
.name-cell {
  max-width: 380px;
}
.name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 700;
  font-size: 13px;
}
.name.mono {
  font-size: 12.5px;
}
.sub {
  display: block;
  font-size: 11.5px;
  color: var(--mt-faint);
}
.no-match {
  padding: 40px;
  text-align: center;
  color: var(--mt-muted);
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
  height: 40px;
  padding: 0 16px;
  background: var(--mt-soft);
  border-top: 1px solid var(--mt-line);
  flex-shrink: 0;
}
.count {
  font-size: 12px;
  color: var(--mt-muted);
}
.more {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.more:disabled {
  opacity: 0.6;
}
@keyframes fade-new {
  from { background: var(--mt-accent-soft); }
}
@media (prefers-reduced-motion: reduce) {
  .item.fresh { animation: none; background: var(--mt-accent-tint); }
}
</style>
