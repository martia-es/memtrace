<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { AnnotationQueueDetailResponse, QueueItemDto, ScoreConfigDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import { shortId } from "@/domain/format";
import { conversationTurns, foldForReview } from "@/domain/review-thread";
import { traceThread } from "@/domain/trace-thread";
import ConversationThread from "../components/ConversationThread.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import { usePermissions } from "../composables/usePermissions";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import { numericChoices } from "../score-config-form";
import Button from "../components/Button.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";
import { t } from "../i18n";

/**
 * Pantalla de revisión (ADR-039): a un lado la conversación (la última pregunta y la respuesta a revisar; lo anterior y
 * los pasos con tools, plegados), al otro la rúbrica. Pensada para ir rápido con el teclado: 1-9 elige y pasa al
 * siguiente criterio, Intro envía, S salta, N abre una nota. "Submit" guarda las etiquetas y trae el siguiente item;
 * "Skip" lo devuelve al pool para otros. Refrescar la página devuelve el mismo item (el servidor lo recuerda).
 * La traza técnica ya no se despliega aquí: es un enlace a su detalle, en otra pestaña, solo con `trace:read_technical`.
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
const roots = computed(() => trace.data.value?.roots ?? []);
const traceGone = computed(() => trace.error.value instanceof ApiError && trace.error.value.status === 404);
const traceHref = computed(() => (item.value?.traceId ? router.resolve({ name: "trace", params: { experimentId: experimentId.value, traceId: item.value.traceId } }).href : null));

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

// ---- the conversation as turns; what came before the last question and the tool steps are folded ----
const openNotes = reactive<Record<string, boolean>>({});
const editing = reactive<Record<string, boolean>>({});
const earlierOpen = ref(false);
const instructionsOpen = ref(true);
const turns = computed(() => conversationTurns(traceThread(roots.value)));
const folded = computed(() => foldForReview(turns.value));
const earlierCount = computed(() => folded.value.earlier.filter((turn) => turn.kind === "user" || turn.kind === "message").length || folded.value.earlier.length);
const hasAnswer = computed(() => turns.value.some((t) => t.kind === "answer"));

function choices(config: ScoreConfigDto): Array<{ value: string; label: string }> | null {
  if (config.dataType === "boolean") return [{ value: "true", label: t("common.yes") }, { value: "false", label: t("common.no") }];
  if (config.dataType === "categorical") return (config.categories ?? []).map((c) => ({ value: c.label, label: c.label }));
  return numericChoices(config)?.map((n) => ({ value: String(n), label: String(n) })) ?? null;
}

/** a criterion with fixed answers folds into one line once answered; "Change" opens it again */
const isFolded = (r: { configId: string; config: ScoreConfigDto }) => !!choices(r.config) && (drafts[r.configId]?.value ?? "") !== "" && !editing[r.configId];
const answerLabel = (r: { configId: string; config: ScoreConfigDto }) => {
  const value = drafts[r.configId]?.value ?? "";
  return choices(r.config)?.find((c) => c.value === value)?.label ?? value;
};
const firstUnanswered = computed(() => rubric.value.find((r) => (drafts[r.configId]?.value ?? "") === ""));
/** the criterion the number keys answer: one being changed, else the first still open */
const activeId = computed(() => Object.keys(editing).find((id) => editing[id]) ?? firstUnanswered.value?.configId);

function choose(configId: string, value: string) {
  drafts[configId]!.value = value;
  editing[configId] = false;
}

function pickByKey(key: string) {
  const target = rubric.value.find((r) => r.configId === activeId.value);
  const option = target ? (choices(target.config) ?? [])[Number(key) - 1] : undefined;
  if (target && option) choose(target.configId, option.value);
}

async function openNote() {
  const id = activeId.value ?? rubric.value[0]?.configId;
  if (!id) return;
  openNotes[id] = true;
  await nextTick();
  document.querySelector<HTMLTextAreaElement>(`[data-note="${id}"] textarea`)?.focus();
}

function onKey(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || !item.value) return;
  const tag = (event.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  const key = event.key.toLowerCase();
  if (/^[1-9]$/.test(key)) pickByKey(key);
  else if (key === "enter" && ready.value && !busy.value) void submit();
  else if (key === "s" && !busy.value) void skip();
  else if (key === "n") {
    event.preventDefault();
    void openNote();
  }
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
    earlierOpen.value = false;
    for (const key of Object.keys(openNotes)) delete openNotes[key];
    for (const key of Object.keys(editing)) delete editing[key];
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
    instructionsOpen.value = false;
    await loadNext();
  } catch (error) {
    notifyError(t("annotationQueueReviewPage.could_not_save_the_review"), error);
  } finally {
    busy.value = false;
  }
}

async function skip() {
  if (!item.value) return;
  busy.value = true;
  try {
    await api.skipAnnotationQueueItem(props.queueId, item.value.id);
    instructionsOpen.value = false;
    await loadNext();
  } catch (error) {
    notifyError(t("annotationQueueReviewPage.could_not_skip_the_item"), error);
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
    notifyError(t("annotationQueueReviewPage.could_not_mark_item_as_unreviewable"), error);
  } finally {
    busy.value = false;
  }
}

const back = () => void router.push({ name: "annotation-queues", params: { experimentId: experimentId.value } });
const progress = computed(() => {
  const p = queue.value?.progress;
  if (!p) return null;
  const total = p.completed + p.pending + p.skipped;
  return { current: Math.min(p.completed + 1, total), total, pct: Math.round((p.completed / Math.max(1, total)) * 100) };
});
</script>

<template>
  <div class="page">
    <Card as="header" padding="none" block class="head">
      <Button variant="link" class="crumb" @click="back">{{ t("annotationQueueReviewPage.review") }}</Button>
      <span class="muted">/</span>
      <h1>{{ queue?.name ?? t("annotationQueueReviewPage.queue") }}</h1>
      <div v-if="progress" class="progress-wrap">
        <span class="muted counts" data-testid="progress">{{ t("annotationQueueReviewPage.item_current_of_total", { current: progress.current, total: progress.total }) }}</span>
        <div class="bar" aria-hidden="true"><div class="bar-fill" :style="{ width: `${progress.pct}%` }" /></div>
      </div>
    </Card>

    <ErrorBanner v-if="loadError" :error="loadError" @retry="loadError = null; loadNext()" />
    <LoadingState v-else-if="!queue" size="lg" />

    <EmptyState v-else-if="finished" icon="task_alt" :title="t('annotationQueueReviewPage.nothing_left_to_review_here')">
      {{ t("annotationQueueReviewPage.you_have_reviewed_everything_this_queue") }}
      <div class="q-mt-md"><Button variant="primary" @click="back">{{ t("annotationQueueReviewPage.back_to_queues") }}</Button></div>
    </EmptyState>

    <div v-else-if="item" class="cols">
      <Card as="section" padding="none" block class="main" :aria-label="t('annotationQueueReviewPage.item_to_review')">
        <template v-if="item.targetType === 'trace'">
          <ErrorBanner v-if="trace.error.value && !traceGone" :error="trace.error.value" @retry="trace.run()" />
          <p v-else-if="traceGone" class="gone" data-testid="trace-gone">
            {{ t("annotationQueueReviewPage.this_trace_is_no_longer_available") }}
          </p>
          <LoadingState v-else-if="!trace.data.value" size="md" />
          <template v-else>
            <div class="convo">
              <template v-if="folded.earlier.length">
                <Button variant="link" class="earlier" :aria-expanded="earlierOpen" data-testid="earlier-toggle" @click="earlierOpen = !earlierOpen">
                  {{ earlierOpen ? t("annotationQueueReviewPage.hide_earlier_messages") : t("annotationQueueReviewPage.earlier_messages", { count: earlierCount }) }}
                </Button>
                <ConversationThread v-if="earlierOpen" :turns="folded.earlier" data-testid="earlier-thread" />
              </template>
              <ConversationThread :turns="folded.recent" answer-label="Reply to review">
                <div v-if="turns.length && !hasAnswer" class="no-answer" data-testid="no-answer">
                  <q-icon name="warning" size="18px" />
                  <span v-if="trace.data.value && trace.data.value.errorCount > 0" data-testid="agent-failed">
                    {{ t("annotationQueueReviewPage.the_agent_failed_before_replying_to") }}
                  </span>
                  <span v-else>{{ t("annotationQueueReviewPage.the_assistant_s_final_reply_was") }}</span>
                </div>
                <p v-if="!turns.length" class="gone">{{ t("annotationQueueReviewPage.this_trace_has_no_content_saved") }}</p>
              </ConversationThread>
            </div>
            <footer v-if="traceHref && can('trace:read_technical')" class="main-foot">
              <a :href="traceHref" target="_blank" rel="noopener" data-testid="trace-link">{{ t("annotationQueueReviewPage.technical_trace") }}</a>
            </footer>
          </template>
        </template>
        <p v-else class="gone">
          {{ t('annotationQueueReviewPage.run_item_index_of_run', { index: item.itemIndex }) }} <span class="mono">{{ shortId(item.datasetRunId ?? "") }}</span>{{ t("annotationQueueReviewPage.review_its_input_and_output_in") }}
        </p>
      </Card>

      <Card as="aside" padding="none" block class="rubric" :aria-label="t('annotationQueueReviewPage.rubric')" data-testid="rubric">
        <div class="rubric-head">
          <h2 class="section-title">{{ t("annotationQueueReviewPage.your_review") }}</h2>
          <Button variant="link" v-if="queue.instructions" :aria-expanded="instructionsOpen" data-testid="instructions-toggle" @click="instructionsOpen = !instructionsOpen">{{ t("annotationQueueReviewPage.instructions") }}</Button>
        </div>
        <p v-if="queue.instructions && instructionsOpen" class="instructions"><q-icon name="info" size="16px" /> {{ queue.instructions }}</p>
        <section v-for="r in rubric" :key="r.configId" class="criterion" :class="{ active: activeId === r.configId, folded: isFolded(r) }" data-testid="rubric-config">
          <template v-if="isFolded(r)">
            <div class="answered">
              <q-icon name="check_circle" size="16px" class="done" />
              <span class="name">{{ r.config.name }}</span>
              <strong class="value">{{ answerLabel(r) }}</strong>
              <Button variant="link" size="sm" :data-testid="`change-${r.config.name}`" @click="editing[r.configId] = true">{{ t("annotationQueueReviewPage.change") }}</Button>
            </div>
            <p v-if="drafts[r.configId]?.comment.trim()" class="answered-note">“{{ drafts[r.configId]!.comment.trim() }}”</p>
          </template>
          <template v-else>
            <h3>
              {{ r.config.name }}
              <span v-if="r.required" class="req">{{ t("annotationQueueReviewPage.required") }}</span>
            </h3>
            <p v-if="r.config.description" class="help">{{ r.config.description }}</p>
            <div v-if="choices(r.config)" class="choices">
              <button
                v-for="(c, idx) in choices(r.config)"
                :key="c.value"
                type="button"
                class="choice"
                :class="{ on: drafts[r.configId]?.value === c.value }"
                @click="choose(r.configId, c.value)"
              >
                {{ c.label }}<kbd v-if="activeId === r.configId && idx < 9">{{ idx + 1 }}</kbd>
              </button>
            </div>
            <TextInput
              v-else-if="drafts[r.configId]"
              v-model="drafts[r.configId]!.value"
              type="number"
              step="any"
              :min="r.config.minValue ?? undefined"
              :max="r.config.maxValue ?? undefined"
              :aria-label="t('annotationQueueReviewPage.name_value', { name: r.config.name })" />
            <Button variant="link" v-if="!openNotes[r.configId]" @click="openNotes[r.configId] = true">{{ t("annotationQueueReviewPage.add_note") }}</Button>
            <div v-if="openNotes[r.configId] && drafts[r.configId]" :data-note="r.configId">
              <TextInput
                v-model="drafts[r.configId]!.comment"
                multiline
                :rows="2"
                maxlength="5000"
                :placeholder="t('annotationQueueReviewPage.optional_note_for_this_criterion')"
                :aria-label="t('annotationQueueReviewPage.name_note', { name: r.config.name })"
              />
            </div>
          </template>
        </section>
        <div class="actions">
          <Button variant="primary" class="submit" :disabled="busy || !ready" data-testid="submit" @click="submit">
            {{ t("annotationQueueReviewPage.submit_amp_next") }}<kbd>Enter</kbd>
          </Button>
          <div class="secondary">
            <Button variant="link" size="sm" :disabled="busy" data-testid="skip" @click="skip">{{ t("annotationQueueReviewPage.skip") }}<kbd>S</kbd></Button>
            <Button variant="link" size="sm" :disabled="busy" data-testid="mark-unreviewable" @click="markUnreviewable">{{ t("annotationQueueReviewPage.mark_unreviewable") }}</Button>
          </div>
        </div>
      </Card>
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
  height: 44px;
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
.counts {
  font-family: var(--mt-mono);
}
.bar {
  width: 120px;
  height: 4px;
  border-radius: 2px;
  background: var(--mt-line-2);
}
.bar-fill {
  height: 4px;
  border-radius: 2px;
  background: var(--mt-accent);
  transition: width 0.3s ease;
}

.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 0;
}
.cols {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 12px;
}
.main {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  background: var(--mt-card);
}
.convo {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 22px 26px;
}
.earlier {
  align-self: flex-start;
}
.main-foot {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  padding: 10px 20px;
  border-top: 1px solid var(--mt-line);
  background: var(--mt-card);
  font-size: 12px;
  font-weight: 700;
}
.main-foot a {
  color: var(--mt-accent-text);
  text-decoration: none;
}
.main-foot a:hover {
  text-decoration: underline;
}
.section-title {
  margin: 0;
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
.gone {
  margin: 0;
  padding: 24px;
  color: var(--mt-muted);
  font-size: 13px;
}
.rubric {
  overflow: auto;
  padding: 16px 20px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rubric-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  padding: 14px;
  border-radius: var(--mt-radius);
  border: 1px solid var(--mt-line);
}
.criterion.active {
  border-color: var(--mt-accent);
  box-shadow: 0 0 0 3px var(--mt-accent-soft);
}
.criterion.folded {
  gap: 4px;
  padding: 10px 12px;
  border-color: transparent;
  background: var(--mt-soft);
}
.criterion h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 800;
}
.answered {
  display: flex;
  align-items: center;
  gap: 8px;
}
.answered .name {
  color: var(--mt-muted);
  font-weight: 700;
}
.answered .value {
  margin-left: auto;
  font-weight: 800;
}
.answered-note {
  margin: 0 0 0 24px;
  color: var(--mt-muted);
  font-size: 12.5px;
  line-height: 1.45;
}
.req {
  color: var(--mt-err-ink);
  font-size: 11px;
  font-weight: 700;
}
.done {
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
  gap: 8px;
}
.choice {
  flex: 1 1 auto;
  min-width: 56px;
  height: 48px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 15px;
  font-weight: 800;
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
kbd {
  font-family: var(--mt-mono);
  font-size: 10.5px;
  font-weight: 500;
  opacity: 0.6;
}
.actions {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  padding: 14px 0 16px;
  background: var(--mt-card);
  border-top: 1px solid var(--mt-line);
}
.submit {
  width: 100%;
  height: 44px;
  gap: 10px;
}
.submit kbd {
  margin-left: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.22);
  opacity: 1;
}
.secondary {
  display: flex;
  justify-content: center;
  gap: 22px;
}
.secondary kbd {
  margin-left: 6px;
}
</style>
