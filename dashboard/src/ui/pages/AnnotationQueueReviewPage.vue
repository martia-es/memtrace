<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { AnnotationQueueDetailResponse, QueueItemDto, ScoreConfigDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import { shortId } from "@/domain/format";
import { conversationTurns } from "@/domain/review-thread";
import { traceThread } from "@/domain/trace-thread";
import { findNode, firstErrorNode } from "@/domain/waterfall";
import ConversationThread from "../components/ConversationThread.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import SpanInspector from "../components/SpanInspector.vue";
import SpanTree from "../components/SpanTree.vue";
import { usePermissions } from "../composables/usePermissions";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import { numericChoices } from "../score-config-form";
import Button from "../components/Button.vue";

/**
 * Pantalla de revisión (ADR-039): a un lado la traza (mismos componentes que el detalle de traza), al otro la
 * rúbrica. "Submit" guarda las etiquetas y trae el siguiente item; "Skip" lo devuelve al pool para otros.
 * Refrescar la página devuelve el mismo item (el servidor lo recuerda), no gasta otro.
 */
const props = defineProps<{ queueId: string }>();

const api = useTraceApi();
const { can } = usePermissions();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const experimentId = computed(() => route.params.experimentId as string);

const queue = shallowRef<AnnotationQueueDetailResponse | null>(null);
const item = shallowRef<QueueItemDto | null>(null);
const finished = ref(false);
const loadError = shallowRef<Error | null>(null);
const busy = ref(false);

const trace = useAsync((signal) => api.getTrace(item.value!.traceId!, signal));
const selectedSpan = ref<string | null>(null);
const roots = computed(() => trace.data.value?.roots ?? []);
const selectedNode = computed(() => (selectedSpan.value ? findNode(roots.value, selectedSpan.value) : null) ?? firstErrorNode(roots.value) ?? roots.value[0] ?? null);
const traceGone = computed(() => trace.error.value instanceof ApiError && trace.error.value.status === 404);

// ---- one draft per rubric config, reset for each item ----
const drafts = reactive<Record<string, { value: string; comment: string }>>({});
const rubric = computed(() => {
  const q = queue.value;
  if (!q) return [];
  return q.rubric
    .map((r) => ({ ...r, config: q.configs.find((c) => c.id === r.configId) }))
    .filter((r): r is typeof r & { config: ScoreConfigDto } => !!r.config && !r.config.archivedAt);
});
const ready = computed(() => rubric.value.every((r) => !r.required || (drafts[r.configId]?.value ?? "") !== ""));

// ---- business view: the conversation as turns, the agent's answer last; the span tree is one click away ----
const showTrace = ref(false);
const openNotes = reactive<Record<string, boolean>>({});
const thread = computed(() => traceThread(roots.value));
const turns = computed(() => conversationTurns(thread.value));
const hasAnswer = computed(() => turns.value.some((t) => t.kind === "answer"));
const firstUnanswered = computed(() => rubric.value.find((r) => (drafts[r.configId]?.value ?? "") === ""));

function pickByKey(key: string) {
  const target = firstUnanswered.value;
  if (!target) return;
  const options = choices(target.config) ?? [];
  const option = options[Number(key) - 1];
  if (option) drafts[target.configId]!.value = option.value;
}

function onKey(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (/^[1-9]$/.test(event.key)) pickByKey(event.key);
  if (event.key === "Enter" && ready.value && !busy.value) void submit();
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

function resetDrafts() {
  for (const key of Object.keys(drafts)) delete drafts[key];
  for (const r of rubric.value) drafts[r.configId] = { value: "", comment: "" };
}

function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
}

async function loadNext() {
  try {
    const [detail, next] = await Promise.all([api.getAnnotationQueue(props.queueId), api.nextAnnotationQueueItem(props.queueId)]);
    queue.value = detail;
    item.value = next.item;
    finished.value = next.item === null;
    selectedSpan.value = null;
    showTrace.value = false;
    for (const key of Object.keys(openNotes)) delete openNotes[key];
    resetDrafts();
    if (next.item?.targetType === "trace" && next.item.traceId) void trace.run();
  } catch (error) {
    loadError.value = error instanceof Error ? error : new Error(String(error));
  }
}
void loadNext();
watch(() => props.queueId, () => void loadNext());

async function submit() {
  if (!item.value || !ready.value) return;
  busy.value = true;
  try {
    const labels = rubric.value
      .filter((r) => drafts[r.configId]?.value !== "")
      .map((r) => ({ configId: r.configId, value: drafts[r.configId]!.value, comment: drafts[r.configId]!.comment.trim() || null }));
    await api.completeAnnotationQueueItem(props.queueId, item.value.id, labels);
    await loadNext();
  } catch (error) {
    notifyError("Could not save the review", error);
  } finally {
    busy.value = false;
  }
}

async function skip() {
  if (!item.value) return;
  busy.value = true;
  try {
    await api.skipAnnotationQueueItem(props.queueId, item.value.id);
    await loadNext();
  } catch (error) {
    notifyError("Could not skip the item", error);
  } finally {
    busy.value = false;
  }
}

async function markUnreviewable() {
  if (!item.value) return;
  busy.value = true;
  try {
    await api.markAnnotationQueueItemUnreviewable(props.queueId, item.value.id);
    await loadNext();
  } catch (error) {
    notifyError("Could not mark item as unreviewable", error);
  } finally {
    busy.value = false;
  }
}

function choices(config: ScoreConfigDto): Array<{ value: string; label: string }> | null {
  if (config.dataType === "boolean") return [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
  if (config.dataType === "categorical") return (config.categories ?? []).map((c) => ({ value: c.label, label: c.label }));
  return numericChoices(config)?.map((n) => ({ value: String(n), label: String(n) })) ?? null;
}

const back = () => void router.push({ name: "annotation-queues", params: { experimentId: experimentId.value } });
const progress = computed(() => queue.value?.progress);
</script>

<template>
  <div class="page">
    <header class="head mt-card">
      <button type="button" class="crumb" @click="back">← Review</button>
      <span class="muted">/</span>
      <h1>{{ queue?.name ?? "Queue" }}</h1>
      <div v-if="progress" class="progress-wrap">
        <span class="muted counts" data-testid="progress">{{ progress.completed }} done · {{ progress.pending }} pending</span>
        <div class="bar" aria-hidden="true"><div class="bar-fill" :style="{ width: `${Math.round((progress.completed / Math.max(1, progress.completed + progress.pending + progress.skipped)) * 100)}%` }" /></div>
      </div>
    </header>

    <ErrorBanner v-if="loadError" :error="loadError" @retry="loadError = null; loadNext()" />
    <div v-else-if="!queue" class="loading"><q-spinner size="32px" color="primary" /></div>

    <EmptyState v-else-if="finished" icon="task_alt" title="Nothing left to review here">
      You have reviewed everything this queue has for you.
      <div class="q-mt-md"><Button variant="primary" @click="back">Back to queues</Button></div>
    </EmptyState>

    <div v-else-if="item" class="cols">
      <section class="mt-card main" aria-label="Item to review">
        <template v-if="item.targetType === 'trace'">
          <ErrorBanner v-if="trace.error.value && !traceGone" :error="trace.error.value" @retry="trace.run()" />
          <p v-else-if="traceGone" class="gone" data-testid="trace-gone">
            This trace is no longer available (it may have been deleted by retention). Skip it; an admin can mark it unreviewable.
          </p>
          <div v-else-if="!trace.data.value" class="loading"><q-spinner size="28px" color="primary" /></div>
          <template v-else>
            <h2 class="section-title">Conversation</h2>
            <ConversationThread :turns="turns" answer-label="Reply to review">
              <div v-if="turns.length && !hasAnswer" class="no-answer" data-testid="no-answer">
                <q-icon name="warning" size="18px" />
                <span v-if="trace.data.value && trace.data.value.errorCount > 0" data-testid="agent-failed">
                  The agent failed before replying to the last message (see the error in the technical trace). There is nothing to review: skip it or mark it unreviewable.
                </span>
                <span v-else>The assistant's final reply was not captured in this trace. Skip it or mark it unreviewable.</span>
              </div>
              <p v-if="!turns.length" class="gone">This trace has no content saved. Skip it or check the technical view.</p>
            </ConversationThread>

            <Button variant="link" v-if="can('trace:read_technical')" :aria-expanded="showTrace" data-testid="trace-toggle" @click="showTrace = !showTrace">
              {{ showTrace ? "Hide technical trace" : "Show technical trace" }}
            </Button>
            <div v-if="showTrace && can('trace:read_technical')" class="trace-cols" data-testid="technical-trace">
              <SpanTree :roots="roots" :total-ms="trace.data.value.durationMs" :selected-id="selectedNode?.spanId ?? null" @select="(id: string) => (selectedSpan = id)" />
              <SpanInspector v-if="selectedNode" :node="selectedNode" empty-hint="This span has no content saved." />
            </div>
          </template>
        </template>
        <p v-else class="gone">
          Run item #{{ item.itemIndex }} of run <span class="mono">{{ shortId(item.datasetRunId ?? "") }}</span>. Review its input and output in the run's detail.
        </p>
      </section>

      <aside class="mt-card rubric" aria-label="Rubric" data-testid="rubric">
        <h2 class="section-title">Your review</h2>
        <p v-if="queue.instructions" class="instructions"><q-icon name="info" size="16px" /> {{ queue.instructions }}</p>
        <section v-for="r in rubric" :key="r.configId" class="criterion" data-testid="rubric-config">
          <h3>
            {{ r.config.name }}
            <span v-if="r.required" class="req">required</span>
            <q-icon v-if="drafts[r.configId]?.value" name="check_circle" size="16px" class="done" />
          </h3>
          <p v-if="r.config.description" class="help">{{ r.config.description }}</p>
          <div v-if="choices(r.config)" class="choices">
            <button
              v-for="(c, idx) in choices(r.config)"
              :key="c.value"
              type="button"
              class="choice"
              :class="{ on: drafts[r.configId]?.value === c.value }"
              @click="drafts[r.configId]!.value = c.value"
            >
              {{ c.label }}<kbd v-if="firstUnanswered?.configId === r.configId && idx < 9">{{ idx + 1 }}</kbd>
            </button>
          </div>
          <TextInput
            v-else-if="drafts[r.configId]"
            v-model="drafts[r.configId]!.value"
            type="number"
            step="any"
            :min="r.config.minValue ?? undefined"
            :max="r.config.maxValue ?? undefined"
            :aria-label="`${r.config.name} value`" />
          <button v-if="!openNotes[r.configId]" type="button" class="note-toggle" @click="openNotes[r.configId] = true">+ Add note</button>
          <TextInput
            v-if="openNotes[r.configId] && drafts[r.configId]"
            v-model="drafts[r.configId]!.comment"
            multiline
            :rows="2"
            maxlength="5000"
            placeholder="Optional note for this criterion"
            :aria-label="`${r.config.name} note`"
          />
        </section>
        <div class="buttons">
          <Button size="sm" :disabled="busy" data-testid="mark-unreviewable" @click="markUnreviewable">Mark unreviewable</Button>
          <Button size="sm" :disabled="busy" data-testid="skip" @click="skip">Skip</Button>
          <Button variant="primary" :disabled="busy || !ready" data-testid="submit" @click="submit">Submit &amp; next</Button>
        </div>
        <p class="hint">Keys 1–9 pick an answer for the first open criterion · Enter submits</p>
      </aside>
    </div>
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
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  box-sizing: border-box;
  padding: 0 18px;
  flex-shrink: 0;
}
.head h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}
.progress-wrap {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.bar {
  width: 200px;
  height: 6px;
  border-radius: 3px;
  background: var(--mt-line-2);
}
.bar-fill {
  height: 6px;
  border-radius: 3px;
  background: var(--mt-accent);
  transition: width 0.3s ease;
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
.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 0;
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.cols {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  gap: 12px;
}
.main {
  min-height: 0;
  overflow: auto;
  padding: 18px 22px;
  background: var(--mt-card);
}
.section-title {
  margin: 0 0 12px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mt-muted);
}
.no-answer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--mt-radius-sm);
  border: 1px dashed var(--mt-line);
  color: var(--mt-muted);
  font-size: 13px;
}
.link {
  display: block;
  margin: 16px 0 12px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.trace-cols {
  position: relative;
  padding-top: 22px; /* the time-axis labels of SpanTree are drawn above their track */
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}
.gone {
  margin: 0;
  padding: 24px;
  color: var(--mt-muted);
  font-size: 13px;
}
.rubric {
  overflow: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.instructions {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
  font-size: 12.5px;
  line-height: 1.45;
  white-space: pre-wrap;
}
.criterion {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.criterion h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}
.req {
  color: var(--mt-err-ink);
  font-size: 11px;
  font-weight: 700;
}
.done {
  margin-left: auto;
  color: var(--mt-ok-ink);
}
.help {
  margin: 0;
  white-space: pre-wrap;
  font-size: 12.5px;
  color: var(--mt-muted);
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.choice {
  flex: 1 1 auto;
  min-width: 64px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.choice:hover {
  border-color: var(--mt-accent);
}
.choice.on {
  border-color: var(--mt-accent);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
  box-shadow: 0 0 0 3px var(--mt-accent-soft);
}
.choice kbd {
  font-family: var(--mt-mono);
  font-size: 10.5px;
  font-weight: 500;
  opacity: 0.6;
}
.note-toggle {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.hint {
  margin: 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--mt-faint);
}
.buttons {
  position: sticky;
  bottom: -16px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding: 12px 0 16px;
  background: var(--mt-card);
  border-top: 1px solid var(--mt-line);
}

</style>
