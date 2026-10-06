<script setup lang="ts">
import TopbarSlot from "../components/TopbarSlot.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { withGaps } from "@/domain/conversation";
import { formatCostUsd, formatCount, formatDateTime, formatDuration } from "@/domain/format";
import { findNode } from "@/domain/waterfall";
import ConversationTree from "../components/ConversationTree.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import TraceAnnotationsPanel from "../components/TraceAnnotationsPanel.vue";
import SpanInspector from "../components/SpanInspector.vue";
import TraceTable from "../components/TraceTable.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useLiveRefresh } from "../composables/useLiveRefresh";
import { useTraceApi } from "../composables/useTraceApi";

const props = defineProps<{ conversationId: string }>();
const api = useTraceApi();
const router = useRouter();
const route = useRoute();
const experimentId = computed(() => route.params.experimentId as string);
const f = useFilters();

const PAGE = 100;
const MAX_PAGE = 200;
const turnsLimit = ref(PAGE);

// ---- view toggle: flat table vs unified span tree of the whole conversation ----
const view = computed(() => (route.query.view === "tree" ? "tree" : "table"));
const setView = (mode: "table" | "tree") => void router.replace({ query: { ...route.query, view: mode === "table" ? undefined : mode } });

const tree = useAsync((signal) => api.getConversationTree(props.conversationId, { limit: turnsLimit.value }, signal));
watch(view, (mode) => {
  if (mode === "tree" && !tree.data.value) void tree.run();
});

const selected = ref<{ traceId: string; spanId: string } | null>(null);
const selectSpan = (traceId: string, spanId: string) => (selected.value = { traceId, spanId });
const selectedNode = computed(() => {
  if (!selected.value) return null;
  const turn = tree.data.value?.items.find((t) => t.traceId === selected.value!.traceId);
  return turn ? findNode(turn.roots, selected.value.spanId) : null;
});
const hint = "This span has no content saved. Enable MEMTRACE_CAPTURE_CONTENT=true on the agent to see it here (it's saved as-is: check privacy).";

// ---- conversation and traces (chronological: new ones arrive at the end, so when refreshing we request the loaded range + margin) ----
const detail = useAsync((signal) => api.getConversation(props.conversationId, { limit: turnsLimit.value }, signal));
const more = useAsync((signal) => api.getConversation(props.conversationId, { limit: PAGE, cursor: cursor.value ?? undefined }, signal));
const extra = ref<NonNullable<typeof detail.data.value>["turns"]["items"]>([]);
const cursor = ref<string | null>(null);

async function load() {
  const result = await detail.run();
  if (!result) return;
  extra.value = [];
  cursor.value = result.turns.nextCursor;
  liveRefresh.touch();
}
async function loadMore() {
  const result = await more.run();
  if (!result) return;
  extra.value = [...extra.value, ...result.turns.items];
  cursor.value = result.turns.nextCursor;
}

// The text for each turn comes from the transcript (only exists if the agent captured content, ADR-013)
const transcript = useAsync((signal) => api.getTranscript(props.conversationId, signal));
const labels = computed(() => new Map((transcript.data.value?.turns ?? []).map((t) => [t.traceId, t.user?.replace(/\s+/g, " ").slice(0, 120)])));

const traces = computed(() => withGaps([...(detail.data.value?.turns.items ?? []), ...extra.value]).map((t) => t.trace));

watch(
  () => props.conversationId,
  () => {
    turnsLimit.value = PAGE;
    selected.value = null;
    void load();
    void transcript.run();
    if (route.query.view === "tree") void tree.run();
  },
  { immediate: true },
);

const liveRefresh = useLiveRefresh(
  async () => {
    turnsLimit.value = Math.min(MAX_PAGE, Math.max(PAGE, traces.value.length + 20));
    await Promise.all([load(), transcript.run(), ...(route.query.view === "tree" ? [tree.run()] : [])]);
  },
  { isBusy: () => detail.loading.value || more.loading.value || transcript.loading.value || tree.loading.value },
);

// ---- header ----
const conversation = computed(() => detail.data.value);
const stats = computed(() => {
  const c = conversation.value;
  if (!c) return [];
  return [
    { k: "Traces", v: formatCount(c.turnCount) },
    { k: "Active time", v: formatDuration(c.activeMs) },
    { k: "Tokens", v: c.totalTokens ? formatCount(c.totalTokens) : "–" },
    { k: "Cost", v: formatCostUsd(c.costUsd) ?? "–" },
    { k: "Failed spans", v: formatCount(c.failedSpans) },
  ];
});

// ---- anotar un turno sin salir de la conversación (ADR-050): mismo panel que en el detalle de traza ----
const annotatingTrace = ref<string | null>(null);

const openTrace = (traceId: string) => void router.push({ name: "trace", params: { experimentId: experimentId.value, traceId }, query: f.shared.value });
const backToList = () => void router.push({ name: "conversations", params: { experimentId: experimentId.value }, query: { ...f.shared.value, group: "conversation" } });
</script>

<template>
  <div class="page">
    <TopbarSlot side="left">
      <nav class="crumbs" aria-label="Breadcrumbs">
        <button type="button" class="crumb" @click="backToList">← Conversations</button>
        <span class="sep">/</span>
        <span class="mono current">{{ conversationId }}</span>
      </nav>
    </TopbarSlot>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="load" />
    <div v-else-if="!conversation" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-if="conversation">
      <header class="head mt-card">
        <div class="titles">
          <div class="title-row">
            <h1 class="leading-none" :title="conversation.title ?? undefined">{{ conversation.title ?? "Conversation" }}</h1>
            <span v-if="conversation.errorTurns" class="mt-pill error">{{ conversation.errorTurns }} {{ conversation.errorTurns === 1 ? "trace with error" : "traces with error" }}</span>
            <span v-else-if="conversation.failedSpans" class="mt-pill warn">{{ conversation.failedSpans }} {{ conversation.failedSpans === 1 ? "span with failures" : "spans with failures" }}</span>
          </div>
          <span class="muted sub"><span class="mono id">{{ conversationId }}</span> · {{ conversation.serviceNames.join(", ") }} · {{ formatDateTime(conversation.startTime) }}</span>
        </div>
        <div class="stats">
          <div v-for="s in stats" :key="s.k" class="stat"><span class="muted k">{{ s.k }}</span><span class="v">{{ s.v }}</span></div>
        </div>
        <div class="view-toggle" role="group" aria-label="View mode">
          <button type="button" class="toggle-btn" :class="{ active: view === 'table' }" @click="setView('table')">Table</button>
          <button type="button" class="toggle-btn" :class="{ active: view === 'tree' }" @click="setView('tree')">Tree</button>
        </div>
      </header>

      <section v-if="view === 'table'" class="mt-card list" aria-label="Conversation traces">
        <TraceTable v-if="traces.length" :items="traces" :labels="labels" annotatable @open="openTrace" @annotate="annotatingTrace = $event" />
        <p v-else class="muted empty">This conversation has no traces to show.</p>
        <button v-if="cursor" type="button" class="more" :disabled="more.loading.value" @click="loadMore">{{ more.loading.value ? "Loading…" : "Load more traces" }}</button>
        <ErrorBanner v-if="more.error.value" :error="more.error.value" @retry="loadMore" />
      </section>

      <template v-else>
        <ErrorBanner v-if="tree.error.value" :error="tree.error.value" @retry="tree.run" />
        <div v-else-if="!tree.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
        <div v-else class="cols">
          <section class="mt-card tree-card" aria-label="Conversation span tree">
            <ConversationTree :turns="tree.data.value.items" :selected-trace-id="selected?.traceId ?? null" :selected-span-id="selected?.spanId ?? null" @select="selectSpan" />
          </section>
          <SpanInspector v-if="selectedNode" :node="selectedNode" :empty-hint="hint" />
          <section v-else class="mt-card empty-card">Select a span to inspect it.</section>
        </div>
      </template>
    </template>

    <Modal v-if="annotatingTrace" title="Annotate trace" wide @close="annotatingTrace = null">
      <TraceAnnotationsPanel :trace-id="annotatingTrace" :experiment-id="experimentId" :span="null" />
    </Modal>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--mt-muted);
  font-size: 13px;
  white-space: nowrap;
}
.sep {
  color: var(--mt-faint);
}
.crumb {
  border: 0;
  background: none;
  padding: 0;
  color: var(--mt-accent-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.current {
  color: var(--mt-ink);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.muted {
  color: var(--mt-muted);
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
.head {
  box-sizing: border-box;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-shrink: 0;
}
.titles {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
}
.id {
  color: var(--mt-accent-text);
  font-size: 12px;
}
.stats {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 14px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
}
.stat .k {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.stat .v {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.view-toggle {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  flex-shrink: 0;
}
.toggle-btn {
  border: 0;
  background: none;
  padding: 5px 14px;
  border-radius: var(--mt-radius-xs);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mt-muted);
  cursor: pointer;
}
.toggle-btn.active {
  background: var(--mt-card);
  color: var(--mt-ink);
  box-shadow: 0 0 0 1px var(--mt-line);
}
.list {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
/* árbol ~40 % · inspector ~60 %, igual que en TraceDetailPage */
.cols {
  display: grid;
  grid-template-columns: minmax(300px, 2fr) minmax(0, 3fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.tree-card {
  box-sizing: border-box;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.empty-card {
  padding: 30px;
  color: var(--mt-muted);
}
.empty {
  margin: 0;
  padding: 20px;
}
.more {
  display: block;
  margin: 12px auto;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
@media (max-width: 1100px) {
  .stats {
    display: none;
  }
  .cols {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }
  .tree-card {
    max-height: 50vh;
  }
}
</style>
