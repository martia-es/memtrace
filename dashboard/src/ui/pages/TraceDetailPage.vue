<script setup lang="ts">
import TopbarSlot from "../components/TopbarSlot.vue";
import { computed, ref, useTemplateRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatCostUsd, formatCount, formatDateTime, formatDuration, shortId } from "@/domain/format";
import { conversationSteps } from "@/domain/conversation-steps";
import { conversationTurns } from "@/domain/review-thread";
import { traceSummary, type SpanFilter } from "@/domain/trace-summary";
import { promptsUsedBy } from "@/domain/prompt-playground";
import { traceThread } from "@/domain/trace-thread";
import { findNode, firstErrorNode } from "@/domain/waterfall";
import ConversationSteps from "../components/ConversationSteps.vue";
import ConversationThread from "../components/ConversationThread.vue";
import TraceOverviewBar from "../components/TraceOverviewBar.vue";
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
import { usePromptApi } from "../composables/usePromptApi";
import { useTraceApi } from "../composables/useTraceApi";
import { useExperimentRepo } from "../composables/useExperimentRepo";
import CommitLink from "../components/CommitLink.vue";
import PromptChips from "../components/PromptChips.vue";
import Button from "../components/Button.vue";
import Pill from "../components/Pill.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";
import TabBar from "../components/TabBar.vue";
import { t } from "../i18n";

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
const rootName = computed(() => roots.value.find((r) => !r.orphan)?.name ?? roots.value[0]?.name ?? t("traceDetailPage.trace"));
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
const viewTabs = computed(() => [
  { id: "conversation", label: t("traceDetailPage.conversation") },
  ...(canTechnical.value ? [{ id: "trace", label: t("traceDetailPage.technical_trace"), count: formatCount(trace.data.value?.spanCount ?? 0) }] : []),
]);
const setTab = (value: "conversation" | "trace") => void router.replace({ query: { ...route.query, tab: value === "trace" ? undefined : value } });
const turns = computed(() => conversationTurns(traceThread(roots.value)));

// ---- the conversation shows how the reply was built (guardrails, retrieved passages, tool calls) between the last
// user message and the reply; the tool lines and data blobs the messages carry are replaced by those steps ----
const steps = computed(() => conversationSteps(roots.value));
const shownTurns = computed(() => {
  if (!steps.value.length) return turns.value;
  const lastUser = turns.value.map((t) => t.kind).lastIndexOf("user");
  return turns.value.filter((t, i) => i <= lastUser || (t.kind !== "action" && t.kind !== "data"));
});
const openSpanInTrace = (spanId: string) => void router.replace({ query: { ...route.query, tab: undefined, span: spanId } });

// ---- technical trace: summary, filters and folded guardrail checks ----
const summary = computed(() => traceSummary(roots.value, trace.data.value?.durationMs ?? 0));
const spanFilter = ref<SpanFilter>("all");
const groupGuardrails = ref(true);

// ---- human annotation (ADR-037) ----
const annotating = ref(false);
const labelsVersion = ref(0);
const closeAnnotate = () => {
  annotating.value = false;
  labelsVersion.value++;
};
const addingToQueue = ref(false);

// ---- probar otra versión del prompt con este mismo mensaje (ADR-071) ----
const promptApi = usePromptApi();
const promptsUsed = computed(() => promptsUsedBy(roots.value));
const replayProblem = ref<string | null>(null);
const replayWithAnotherVersion = () => openPromptFor("try");
// un fallo de esta traza se puede arreglar con un cambio de prompt (ADR-072): se abre el prompt en «Fix a failure»
const fixThisFailure = () => openPromptFor("fix");
async function openPromptFor(tab: "try" | "fix") {
  const used = promptsUsed.value[0];
  if (!used) return;
  replayProblem.value = null;
  try {
    const found = (await promptApi.listForAgent(experimentId.value, true)).find((p) => p.name === used.name);
    if (!found) {
      replayProblem.value = t("traceDetailPage.the_prompt_name_does_not_belong", { name: used.name });
      return;
    }
    await router.push({ name: "prompt", params: { experimentId: experimentId.value, promptId: found.id }, query: { tab, trace: props.traceId } });
  } catch (error) {
    replayProblem.value = error instanceof Error ? error.message : t("traceDetailPage.could_not_open_the_prompt");
  }
}
const addingToDataset = ref(false);

const hint = computed(() => t("traceDetailPage.this_span_has_no_content_saved"));

const treeRef = useTemplateRef<InstanceType<typeof SpanTree>>("treeRef");
const copyId = () => void navigator.clipboard?.writeText(props.traceId);
const goList = () => void router.push({ name: "conversations", params: { experimentId: experimentId.value }, query: f.shared.value });
const goConversation = () => conversationId.value && void router.push({ name: "conversation", params: { experimentId: experimentId.value, conversationId: conversationId.value }, query: f.shared.value });
</script>

<template>
  <div class="page">
    <TopbarSlot side="left">
      <nav class="crumbs" :aria-label="t('traceDetailPage.breadcrumbs')">
        <Button variant="link" class="crumb" @click="goList">{{ t("traceDetailPage.conversations") }}</Button>
        <template v-if="conversationId">
          <span class="sep">/</span>
          <Button variant="link" class="crumb mono" @click="goConversation">{{ conversationId }}</Button>
        </template>
        <span class="sep">/</span>
        <span class="mono current">{{ shortId(traceId) }}</span>
      </nav>
    </TopbarSlot>
    <ErrorBanner v-if="trace.error.value" :error="trace.error.value" @retry="trace.run()" />
    <LoadingState v-else-if="!trace.data.value" size="lg" />

    <template v-if="trace.data.value">
      <Card as="header" padding="none" block class="head">
        <div class="title-row">
          <h1 :title="rootName">{{ rootName }}</h1>
          <StatusBadge :status="trace.data.value.status" show-label />
          <Pill v-if="trace.data.value.framework">{{ trace.data.value.framework }}</Pill>
          <PromptChips :prompts="promptsUsed" />
          <span class="commit" data-testid="trace-revision"><span class="commit-label">{{ t("traceDetailPage.commit") }}</span><CommitLink :revision="trace.data.value.revision" :repo="repo" /></span>
          <div class="actions">
            <Button :aria-label="t('traceDetailPage.copy_trace_id')" @click="copyId">{{ t("traceDetailPage.copy_id") }}</Button>
            <Button data-testid="add-to-dataset-btn" @click="addingToDataset = true">{{ t("traceDetailPage.add_to_dataset") }}</Button>
            <Button data-testid="add-to-queue-btn" @click="addingToQueue = true">{{ t("traceDetailPage.add_to_queue") }}</Button>
            <Button
              v-if="promptsUsed.length > 0"
             
             
              :title="t('traceDetailPage.run_the_same_message_with_another', { name: promptsUsed[0]!.name, version: promptsUsed[0]!.version })"
              data-testid="replay-btn"
              @click="replayWithAnotherVersion"
            >
              {{ t("traceDetailPage.try_another_prompt_version") }}
            </Button>
            <Button
              v-if="promptsUsed.length > 0 && trace.data.value.errorCount > 0"
             
             
              :title="t('traceDetailPage.propose_a_change_to_name_that', { name: promptsUsed[0]!.name })"
              data-testid="fix-btn"
              @click="fixThisFailure"
            >
              {{ t("traceDetailPage.fix_with_a_prompt_change") }}
            </Button>
            <Button variant="primary" data-testid="annotate-btn" @click="annotating = true">{{ t("traceDetailPage.annotate") }}</Button>
          </div>
        </div>
        <div class="meta-line">
          <span>{{ t("traceDetailPage.started") }} <b>{{ formatDateTime(trace.data.value.startTime) }}</b></span>
          <span>{{ t("traceDetailPage.duration") }} <b class="mono">{{ formatDuration(trace.data.value.durationMs) }}</b></span>
          <span>{{ t("traceDetailPage.spans") }} <b class="mono">{{ formatCount(trace.data.value.spanCount) }}</b></span>
          <span v-if="trace.data.value.errorCount" class="bad">{{ t("traceDetailPage.failed") }} <b class="mono">{{ trace.data.value.errorCount }}</b></span>
          <span v-if="trace.data.value.totalTokens">{{ t("traceDetailPage.tokens") }} <b class="mono">{{ formatCount(trace.data.value.totalTokens) }}</b></span>
          <span v-if="trace.data.value.totalCostUsd">{{ t("traceDetailPage.cost") }} <b class="mono">{{ formatCostUsd(trace.data.value.totalCostUsd) }}</b></span>
        </div>
      </Card>

      <p v-if="replayProblem" class="bad replay-problem" role="alert" data-testid="replay-problem">{{ replayProblem }}</p>
      <TraceFeedbackStrip :trace-id="traceId" />

      <div class="body">
      <div class="main">
      <TabBar :tabs="viewTabs" :model-value="tab" @update:model-value="setTab($event as 'conversation' | 'trace')">
        <template #trailing><span class="tabs-hint">{{ tab === "trace" ? t("traceDetailPage.select_a_span_to_see_its") : t("traceDetailPage.the_messages_exchanged_without_ids_or") }}</span></template>
      </TabBar>

      <div v-if="trace.data.value.truncated" class="banner warn">{{ t("traceDetailPage.trace_has_more_than_5000_spans") }}</div>
      <div v-if="hasOrphans" class="banner warn">
        <template v-if="inProgress">{{ t("traceDetailPage.the_trace_is_still_in_progress") }}</template>
        <template v-else>{{ t("traceDetailPage.some_spans_have_no_parent_in") }}</template>
      </div>

      <Card as="section" padding="none" block v-if="tab === 'conversation'" class="thread-card" :aria-label="t('traceDetailPage.conversation')">
        <ConversationThread v-if="turns.length" :turns="shownTurns">
          <template v-if="steps.length" #steps>
            <ConversationSteps :steps="steps" :can-open-trace="canTechnical" @open-span="openSpanInTrace" />
          </template>
        </ConversationThread>
        <p v-else class="muted empty-thread">{{ t("traceDetailPage.this_trace_has_no_message_content") + " " }}<code>MEMTRACE_CAPTURE_CONTENT=true</code>{{ " " + t("traceDetailPage.on_the_agent_to_read_the") }}</p>
      </Card>

      <TraceOverviewBar
        v-if="tab === 'trace'"
        v-model:filter="spanFilter"
        v-model:group-guardrails="groupGuardrails"
        :summary="summary"
        :tokens="trace.data.value.totalTokens"
        :cost-usd="trace.data.value.totalCostUsd"
        @select-slowest="select"
      />

      <div v-if="tab === 'trace'" class="cols">
        <Card as="section" padding="none" block class="tree-card" :aria-label="t('traceDetailPage.span_tree')">
          <div class="tree-head">
            <h2>{{ t("traceDetailPage.spans") }}</h2>
            <div class="tree-actions">
              <Button variant="link" @click="treeRef?.expandAll()">{{ t("traceDetailPage.expand_all") }}</Button>
              <span class="dot-sep">·</span>
              <Button variant="link" @click="treeRef?.collapseAll()">{{ t("traceDetailPage.collapse_all") }}</Button>
              <span class="mono muted meta">{{ formatDuration(trace.data.value.durationMs) }}</span>
            </div>
          </div>
          <SpanTree
            ref="treeRef"
            :roots="roots"
            :total-ms="trace.data.value.durationMs"
            :selected-id="selectedNode?.spanId ?? null"
            :filter="spanFilter"
            :group-guardrails="groupGuardrails"
            :slowest-id="summary.slowest?.spanId ?? null"
            @select="select"
          />
        </Card>

        <SpanInspector v-if="selectedNode" :node="selectedNode" :empty-hint="hint" />
        <Card as="section" padding="none" block v-else class="empty-card">{{ t("traceDetailPage.this_trace_has_no_spans_to") }}</Card>
      </div>

      </div>
      <TraceSummaryPanel :trace-id="traceId" :refresh-key="labelsVersion" />
      </div>

      <AddToDatasetModal v-if="addingToDataset" :trace-id="traceId" :roots="roots" @close="addingToDataset = false" />
      <AddToQueueModal v-if="addingToQueue" :trace-id="traceId" @close="addingToQueue = false" />

      <Modal v-if="annotating" :title="t('traceDetailPage.annotate_trace')" wide @close="closeAnnotate">
        <TraceAnnotationsPanel :trace-id="traceId" :experiment-id="experimentId" :span="selectedNode ? { spanId: selectedNode.spanId, name: selectedNode.name } : null" />
      </Modal>
    </template>
  </div>
</template>

<style scoped>
.commit { display: inline-flex; align-items: center; gap: 6px; }
.commit-label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--mt-muted); }
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

.current {
  color: var(--mt-ink);
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
