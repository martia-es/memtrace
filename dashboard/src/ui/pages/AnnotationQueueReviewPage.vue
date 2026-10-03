<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { AnnotationQueueDetailResponse, QueueItemDto, ScoreConfigDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import { shortId } from "@/domain/format";
import { findNode, firstErrorNode } from "@/domain/waterfall";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import SpanInspector from "../components/SpanInspector.vue";
import SpanTree from "../components/SpanTree.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import { numericChoices } from "../score-config-form";

/**
 * Pantalla de revisión (ADR-039): a un lado la traza (mismos componentes que el detalle de traza), al otro la
 * rúbrica. "Submit" guarda las etiquetas y trae el siguiente item; "Skip" lo devuelve al pool para otros.
 * Refrescar la página devuelve el mismo item (el servidor lo recuerda), no gasta otro.
 */
const props = defineProps<{ queueId: string }>();

const api = useTraceApi();
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
      <button type="button" class="crumb" @click="back">Review</button>
      <span class="muted">/</span>
      <h1>{{ queue?.name ?? "Queue" }}</h1>
      <span v-if="progress" class="muted counts" data-testid="progress">{{ progress.completed }} done · {{ progress.pending }} pending</span>
    </header>

    <ErrorBanner v-if="loadError" :error="loadError" @retry="loadError = null; loadNext()" />
    <div v-else-if="!queue" class="loading"><q-spinner size="32px" color="primary" /></div>

    <EmptyState v-else-if="finished" icon="task_alt" title="Nothing left to review here">
      You have reviewed everything this queue has for you.
      <div class="q-mt-md"><button type="button" class="primary-btn" @click="back">Back to queues</button></div>
    </EmptyState>

    <div v-else-if="item" class="cols">
      <section class="mt-card main" aria-label="Item to review">
        <template v-if="item.targetType === 'trace'">
          <ErrorBanner v-if="trace.error.value && !traceGone" :error="trace.error.value" @retry="trace.run()" />
          <p v-else-if="traceGone" class="gone" data-testid="trace-gone">
            This trace is no longer available (it may have been deleted by retention). Skip it; an admin can mark it unreviewable.
          </p>
          <div v-else-if="!trace.data.value" class="loading"><q-spinner size="28px" color="primary" /></div>
          <div v-else class="trace-cols">
            <SpanTree :roots="roots" :total-ms="trace.data.value.durationMs" :selected-id="selectedNode?.spanId ?? null" @select="(id: string) => (selectedSpan = id)" />
            <SpanInspector v-if="selectedNode" :node="selectedNode" empty-hint="This span has no content saved." />
          </div>
        </template>
        <p v-else class="gone">
          Run item #{{ item.itemIndex }} of run <span class="mono">{{ shortId(item.datasetRunId ?? "") }}</span>. Review its input and output in the run's detail.
        </p>
      </section>

      <aside class="mt-card rubric" aria-label="Rubric" data-testid="rubric">
        <p v-if="queue.instructions" class="instructions">{{ queue.instructions }}</p>
        <section v-for="r in rubric" :key="r.configId" class="config" data-testid="rubric-config">
          <div class="config-name">{{ r.config.name }} <span v-if="r.required" class="req">required</span></div>
          <p v-if="r.config.description" class="muted">{{ r.config.description }}</p>
          <div v-if="choices(r.config)" class="choice-row">
            <button
              v-for="c in choices(r.config)"
              :key="c.value"
              type="button"
              class="choice-btn"
              :class="{ active: drafts[r.configId]?.value === c.value }"
              @click="drafts[r.configId]!.value = c.value"
            >
              {{ c.label }}
            </button>
          </div>
          <input
            v-else-if="drafts[r.configId]"
            v-model="drafts[r.configId]!.value"
            class="text-input"
            type="number"
            step="any"
            :min="r.config.minValue ?? undefined"
            :max="r.config.maxValue ?? undefined"
            :aria-label="`${r.config.name} value`"
          />
          <input v-if="drafts[r.configId]" v-model="drafts[r.configId]!.comment" class="text-input" placeholder="Comment (optional)" maxlength="5000" :aria-label="`${r.config.name} comment`" />
        </section>
        <div class="buttons">
          <button type="button" class="small-btn" :disabled="busy" data-testid="skip" @click="skip">Skip</button>
          <button type="button" class="primary-btn" :disabled="busy || !ready" data-testid="submit" @click="submit">Submit &amp; next</button>
        </div>
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
  gap: 10px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  flex-shrink: 0;
}
.head h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}
.counts {
  margin-left: auto;
}
.crumb {
  border: 0;
  background: none;
  padding: 0;
  color: var(--mt-accent);
  font: inherit;
  font-weight: 600;
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
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 10px;
}
.main {
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.trace-cols {
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
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.instructions {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  font-size: 12.5px;
  white-space: pre-wrap;
}
.config {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
}
.config-name {
  font-weight: 700;
  font-size: 13px;
}
.req {
  margin-left: 6px;
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
}
.choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.choice-btn {
  height: 28px;
  min-width: 34px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.choice-btn.active {
  background: var(--mt-accent);
  border-color: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.text-input {
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 12.5px;
  color: var(--mt-ink);
}
.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
}
.small-btn,
.primary-btn {
  height: 34px;
  padding: 0 16px;
  border-radius: var(--mt-radius-lg);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.small-btn {
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
}
.primary-btn {
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.small-btn:disabled,
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
