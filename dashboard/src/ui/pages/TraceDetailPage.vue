<script setup lang="ts">
import TopbarSlot from "../components/TopbarSlot.vue";
import { computed, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatCostUsd, formatCount, formatDateTime, formatDuration, shortId } from "@/domain/format";
import { conversationTurns } from "@/domain/review-thread";
import { traceThread } from "@/domain/trace-thread";
import { findNode, firstErrorNode } from "@/domain/waterfall";
import ConversationThread from "../components/ConversationThread.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import SpanInspector from "../components/SpanInspector.vue";
import SpanTree from "../components/SpanTree.vue";
import Modal from "../components/Modal.vue";
import AddToDatasetModal from "../components/AddToDatasetModal.vue";
import AddToQueueModal from "../components/AddToQueueModal.vue";
import TraceAnnotationsPanel from "../components/TraceAnnotationsPanel.vue";
import TraceFeedbackStrip from "../components/TraceFeedbackStrip.vue";
import TraceSummaryPanel from "../components/TraceSummaryPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { usePermissions } from "../composables/usePermissions";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useLiveRefresh } from "../composables/useLiveRefresh";
import { useTraceApi } from "../composables/useTraceApi";
import { useExperimentRepo } from "../composables/useExperimentRepo";
import CommitLink from "../components/CommitLink.vue";

const props = defineProps<{ traceId: string }>();
const api = useTraceApi();
const route = useRoute();
const router = useRouter();
const experimentId = computed(() => route.params.experimentId as string);
const repo = useExperimentRepo(experimentId);
const f = useFilters();

const trace = useAsync((signal) => api.getTrace(props.traceId, signal));
watch(() => props.traceId, () => void trace.run(), { immediate: true });

// An in-progress trace hasn't exported its root span yet (finishes last): its spans come out as orphans.
// While this happens (and is recent) it auto-updates; when the root arrives it stops refreshing.
const IN_PROGRESS_WINDOW_MS = 5 * 60_000;
const inProgress = computed(() => {
  const t = trace.data.value;
  return Boolean(t && t.roots.some((r) => r.orphan) && Date.now() - Date.parse(t.startTime) < IN_PROGRESS_WINDOW_MS);
});
useLiveRefresh(() => trace.run(), { active: () => inProgress.value, isBusy: () => trace.loading.value });

const roots = computed(() => trace.data.value?.roots ?? []);
const hasOrphans = computed(() => roots.value.some((r) => r.orphan));
const rootName = computed(() => roots.value.find((r) => !r.orphan)?.name ?? roots.value[0]?.name ?? "Trace");
const conversationId = computed(() => trace.data.value?.conversationId ?? null);

// ---- selected span (?span=): the one from the link, if not the first with error, if not the root ----
const selectedNode = computed(() => {
  const wanted = typeof route.query.span === "string" ? route.query.span : null;
  return (wanted ? findNode(roots.value, wanted) : null) ?? firstErrorNode(roots.value) ?? roots.value[0] ?? null;
});
const select = (spanId: string) => void router.replace({ query: { ...route.query, span: spanId } });

// ---- tabs (ADR-048): the technical trace by default, the conversation read like a chat on the other tab ----
const { can } = usePermissions();
const canTechnical = computed(() => can("trace:read_technical"));
const tab = computed<"conversation" | "trace">(() => (!canTechnical.value || route.query.tab === "conversation" ? "conversation" : "trace"));
const setTab = (value: "conversation" | "trace") => void router.replace({ query: { ...route.query, tab: value === "trace" ? undefined : value } });
const turns = computed(() => conversationTurns(traceThread(roots.value)));

// ---- human annotation (ADR-037) ----
const annotating = ref(false);
const labelsVersion = ref(0);
const closeAnnotate = () => {
  annotating.value = false;
  labelsVersion.value++;
};
const addingToQueue = ref(false);
const addingToDataset = ref(false);

const hint = "This span has no content saved. Enable MEMTRACE_CAPTURE_CONTENT=true on the agent to see it here (it's saved as-is: check privacy).";

const treeRef = useTemplateRef<InstanceType<typeof SpanTree>>("treeRef");
const copyId = () => void navigator.clipboard?.writeText(props.traceId);
const goList = () => void router.push({ name: "conversations", params: { experimentId: experimentId.value }, query: f.shared.value });
const goConversation = () => conversationId.value && void router.push({ name: "conversation", params: { experimentId: experimentId.value, conversationId: conversationId.value }, query: f.shared.value });
</script>

<template>
  <div class="page">
    <TopbarSlot side="left">
      <nav class="crumbs" aria-label="Breadcrumbs">
        <button type="button" class="crumb" @click="goList">← Conversations</button>
        <template v-if="conversationId">
          <span class="sep">/</span>
          <button type="button" class="crumb mono" @click="goConversation">{{ conversationId }}</button>
        </template>
        <span class="sep">/</span>
        <span class="mono current">{{ shortId(traceId) }}</span>
      </nav>
    </TopbarSlot>
    <ErrorBanner v-if="trace.error.value" :error="trace.error.value" @retry="trace.run()" />
    <div v-else-if="!trace.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-if="trace.data.value">
      <header class="head mt-card">
        <div class="title-row">
          <h1 :title="rootName">{{ rootName }}</h1>
          <StatusBadge :status="trace.data.value.status" show-label />
          <span v-if="trace.data.value.framework" class="mt-pill unset">{{ trace.data.value.framework }}</span>
          <CommitLink :revision="trace.data.value.revision" :repo="repo" data-testid="trace-revision" />
          <div class="actions">
            <button type="button" class="btn" aria-label="Copy trace ID" @click="copyId">Copy ID</button>
            <button type="button" class="btn" data-testid="add-to-dataset-btn" @click="addingToDataset = true">Add to dataset</button>
            <button type="button" class="btn" data-testid="add-to-queue-btn" @click="addingToQueue = true">Add to queue</button>
            <button type="button" class="btn primary" data-testid="annotate-btn" @click="annotating = true">Annotate</button>
          </div>
        </div>
        <div class="meta-line">
          <span>Started <b>{{ formatDateTime(trace.data.value.startTime) }}</b></span>
          <span>Duration <b class="mono">{{ formatDuration(trace.data.value.durationMs) }}</b></span>
          <span>Spans <b class="mono">{{ formatCount(trace.data.value.spanCount) }}</b></span>
          <span v-if="trace.data.value.errorCount" class="bad">Failed <b class="mono">{{ trace.data.value.errorCount }}</b></span>
          <span v-if="trace.data.value.totalTokens">Tokens <b class="mono">{{ formatCount(trace.data.value.totalTokens) }}</b></span>
          <span v-if="trace.data.value.totalCostUsd">Cost <b class="mono">{{ formatCostUsd(trace.data.value.totalCostUsd) }}</b></span>
        </div>
      </header>

      <TraceFeedbackStrip :trace-id="traceId" />

      <div class="body">
      <div class="main">
      <div class="tabs" role="tablist" aria-label="Trace views">
        <button type="button" role="tab" class="tab" :class="{ active: tab === 'conversation' }" :aria-selected="tab === 'conversation'" data-testid="tab-conversation" @click="setTab('conversation')">Conversation</button>
        <button v-if="canTechnical" type="button" role="tab" class="tab" :class="{ active: tab === 'trace' }" :aria-selected="tab === 'trace'" data-testid="tab-trace" @click="setTab('trace')">
          Technical trace<span class="tab-count mono">{{ formatCount(trace.data.value.spanCount) }}</span>
        </button>
        <span class="tabs-hint">{{ tab === "trace" ? "Select a span to see its input, output and metadata" : "The messages exchanged, without ids or raw JSON" }}</span>
      </div>

      <div v-if="trace.data.value.truncated" class="banner warn">Trace has more than 5000 spans: only showing the first ones.</div>
      <div v-if="hasOrphans" class="banner warn">
        <template v-if="inProgress">The trace is still in progress: auto-updating until the root span arrives.</template>
        <template v-else>Some spans have no parent in the trace (lost or not yet exported) and are shown as roots.</template>
      </div>

      <section v-if="tab === 'conversation'" class="mt-card thread-card" aria-label="Conversation">
        <ConversationThread v-if="turns.length" :turns="turns" />
        <p v-else class="muted empty-thread">This trace has no message content saved. Enable <code>MEMTRACE_CAPTURE_CONTENT=true</code> on the agent to read the conversation here.</p>
      </section>

      <div v-else class="cols">
        <section class="mt-card tree-card" aria-label="Span tree">
          <div class="tree-head">
            <h2>Spans</h2>
            <div class="tree-actions">
              <button type="button" class="link-btn" @click="treeRef?.expandAll()">Expand all</button>
              <span class="dot-sep">·</span>
              <button type="button" class="link-btn" @click="treeRef?.collapseAll()">Collapse all</button>
              <span class="mono muted meta">{{ formatDuration(trace.data.value.durationMs) }}</span>
            </div>
          </div>
          <SpanTree ref="treeRef" :roots="roots" :total-ms="trace.data.value.durationMs" :selected-id="selectedNode?.spanId ?? null" @select="select" />
        </section>

        <SpanInspector v-if="selectedNode" :node="selectedNode" :empty-hint="hint" />
        <section v-else class="mt-card empty-card">This trace has no spans to show.</section>
      </div>

      </div>
      <TraceSummaryPanel :trace-id="traceId" :refresh-key="labelsVersion" />
      </div>

      <AddToDatasetModal v-if="addingToDataset" :trace-id="traceId" :roots="roots" @close="addingToDataset = false" />
      <AddToQueueModal v-if="addingToQueue" :trace-id="traceId" @close="addingToQueue = false" />

      <Modal v-if="annotating" title="Annotate trace" wide @close="closeAnnotate">
        <TraceAnnotationsPanel :trace-id="traceId" :experiment-id="experimentId" :span="selectedNode ? { spanId: selectedNode.spanId, name: selectedNode.name } : null" />
      </Modal>
    </template>
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
h1,
h2 {
  margin: 0;
}
h1 {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
h2 {
  font-size: 14px;
  font-weight: 800;
}
.head {
  box-sizing: border-box;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.btn {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--mt-accent);
}
.btn.primary {
  background: var(--mt-accent);
  border-color: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.meta-line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 22px;
  padding-top: 10px;
  border-top: 1px solid var(--mt-line-2);
  font-size: 12.5px;
  color: var(--mt-muted);
}
.meta-line b {
  color: var(--mt-ink);
  font-weight: 700;
}
.meta-line .mono {
  font-weight: 500;
}
.meta-line .bad,
.meta-line .bad b {
  color: var(--mt-err-ink);
}
.mt-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.mt-pill.unset {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  border-bottom: 1px solid var(--mt-line);
  flex-shrink: 0;
}
.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  margin-bottom: -1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--mt-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.tab.active {
  color: var(--mt-ink);
  border-bottom-color: var(--mt-accent);
}
.tab-count {
  padding: 0 5px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-soft);
  font-size: 11px;
  font-weight: 500;
}
.tabs-hint {
  margin-left: auto;
  padding-bottom: 9px;
  font-size: 12px;
  color: var(--mt-muted);
}
.banner {
  padding: 12px 14px;
  border-radius: var(--mt-radius-lg);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}
.banner.warn {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.thread-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 22px 26px;
  background: var(--mt-card);
}
.empty-thread {
  margin: 0;
  padding: 24px;
  text-align: center;
}
/* contenido a la izquierda, resumen de la traza a la derecha */
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 0;
}
/* árbol ~40 % · inspector ~60 % */
.cols {
  display: grid;
  grid-template-columns: minmax(300px, 2fr) minmax(0, 3fr);
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.tree-card {
  box-sizing: border-box;
  padding: 10px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  min-width: 0;
}
.tree-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px 6px;
}
.tree-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tree-head .meta {
  font-size: 12px;
}
.link-btn {
  border: 0;
  background: none;
  padding: 0;
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.link-btn:hover {
  text-decoration: underline;
}
.dot-sep {
  color: var(--mt-line);
}
.empty-card {
  padding: 30px;
  color: var(--mt-muted);
}
@media (max-width: 1100px) {
  .body {
    grid-template-columns: minmax(0, 1fr);
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
