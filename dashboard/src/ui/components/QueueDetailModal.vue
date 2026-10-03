<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import type { QueueItemDto } from "@contract";
import { shortId } from "@/domain/format";
import { judgeVerdict } from "@/domain/agreement";
import { describeScale } from "../score-config-form";
import ErrorBanner from "./ErrorBanner.vue";
import InterAnnotatorAgreement from "./InterAnnotatorAgreement.vue";
import JudgeHumanAgreement from "./JudgeHumanAgreement.vue";
import Modal from "./Modal.vue";
import PromoteQueueToDataset from "./PromoteQueueToDataset.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

/** Progreso, trabajo por revisor, rúbrica y items de una cola (ADR-039). Los admins pueden cambiar `requiredAnnotations` y retirar items del reparto. */
const props = defineProps<{ queueId: string; canManage: boolean }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const api = useTraceApi();
const $q = useQuasar();

const detail = useAsync((signal) => api.getAnnotationQueue(props.queueId, signal));
const items = useAsync((signal) => api.listAnnotationQueueItems(props.queueId, undefined, signal));
void detail.run();
void items.run();

const hasRunItems = computed(() => items.data.value?.items.some((i) => i.targetType === "run_item") ?? false);
const judgeAgreement = useAsync((signal) => api.getJudgeHumanAgreement({ queueId: props.queueId }, undefined, signal));
void judgeAgreement.run();
const judgeMetrics = computed(() => judgeAgreement.data.value?.metrics ?? []);
const required = ref<number | null>(null);
const total = computed(() => {
  const p = detail.data.value?.progress;
  return p ? p.pending + p.completed + p.skipped : 0;
});
const percent = computed(() => (total.value ? Math.round(((detail.data.value?.progress.completed ?? 0) / total.value) * 100) : 0));

function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
}

async function reload() {
  await Promise.all([detail.run(), items.run()]);
  emit("changed");
}

async function saveRequired() {
  if (required.value === null) return;
  try {
    await api.updateAnnotationQueue(props.queueId, { requiredAnnotations: required.value });
    required.value = null;
    await reload();
  } catch (error) {
    notifyError("Could not update the queue", error);
  }
}

async function markUnreviewable(item: QueueItemDto) {
  try {
    await api.markAnnotationQueueItemUnreviewable(props.queueId, item.id);
    await reload();
  } catch (error) {
    notifyError("Could not mark the item", error);
  }
}

const label = (item: QueueItemDto) => (item.targetType === "trace" ? `Trace ${shortId(item.traceId ?? "")}` : `Run ${shortId(item.datasetRunId ?? "")} · item ${item.itemIndex}`);
</script>

<template>
  <Modal :title="detail.data.value?.name ?? 'Queue'" wide @close="emit('close')">
    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="detail.run()" />
    <div v-else-if="!detail.data.value" class="loading"><q-spinner size="28px" color="primary" /></div>

    <div v-else class="detail" data-testid="queue-detail">
      <p v-if="detail.data.value.instructions" class="instructions">{{ detail.data.value.instructions }}</p>

      <section>
        <h3>Progress</h3>
        <div class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100"><div class="fill" :style="{ width: `${percent}%` }" /></div>
        <p class="muted">
          {{ detail.data.value.progress.completed }} completed · {{ detail.data.value.progress.pending }} pending · {{ detail.data.value.progress.skipped }} unreviewable
        </p>
        <div class="req-row">
          <span class="muted">Reviews required per item:</span>
          <template v-if="canManage">
            <input
              :value="required ?? detail.data.value.requiredAnnotations"
              class="text-input num"
              type="number"
              min="1"
              max="10"
              aria-label="Reviews required per item"
              @input="required = Number(($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="small-btn" :disabled="required === null || required === detail.data.value.requiredAnnotations" @click="saveRequired">Apply</button>
          </template>
          <strong v-else>{{ detail.data.value.requiredAnnotations }}</strong>
        </div>
        <p v-if="canManage" class="muted">Raising it reopens items that were already completed; lowering it can complete them.</p>
      </section>

      <section>
        <h3>Rubric</h3>
        <ul class="plain">
          <li v-for="c in detail.data.value.configs" :key="c.id">
            <strong>{{ c.name }}</strong> <span class="muted">{{ describeScale(c) }}</span>
            <span v-if="detail.data.value.rubric.find((r) => r.configId === c.id)?.required" class="pill">required</span>
            <span v-if="c.archivedAt" class="pill warn">archived</span>
          </li>
        </ul>
      </section>

      <section>
        <h3>Reviewers</h3>
        <p v-if="!detail.data.value.reviewers.length" class="muted">Nobody has started reviewing yet.</p>
        <ul v-else class="plain">
          <li v-for="r in detail.data.value.reviewers" :key="r.userId" data-testid="reviewer-row">
            <strong>{{ r.name ?? "Former member" }}</strong>
            <span class="muted">{{ r.completed }} done · {{ r.skipped }} skipped · {{ r.inProgress }} in progress</span>
          </li>
        </ul>
      </section>

      <section>
        <h3>Agreement between reviewers</h3>
        <InterAnnotatorAgreement :queue-id="queueId" />
      </section>

      <section v-if="hasRunItems && judgeMetrics.length" data-testid="queue-verdict">
        <h3>Judge verdict</h3>
        <ul class="plain">
          <li v-for="m in judgeMetrics" :key="m.name">
            <strong>{{ m.name }}</strong>
            <span class="pill" :class="judgeVerdict(m.kappa).tone">{{ judgeVerdict(m.kappa).text }}</span>
          </li>
        </ul>
      </section>

      <JudgeHumanAgreement v-if="hasRunItems" :scope="{ queueId }" />

      <PromoteQueueToDataset v-if="canManage && items.data.value" :items="items.data.value.items" :configs="detail.data.value.configs" />

      <section>
        <h3>Items</h3>
        <p v-if="!(items.data.value?.items.length ?? 0)" class="muted">The queue is empty. Add traces from this page or from a trace's detail.</p>
        <ul v-else class="plain items">
          <li v-for="item in items.data.value!.items" :key="item.id" data-testid="queue-item-row">
            <span class="mono">{{ label(item) }}</span>
            <span class="pill" :class="item.status">{{ item.status === "skipped" ? "unreviewable" : item.status }}</span>
            <button v-if="canManage && item.status !== 'skipped'" type="button" class="small-btn" @click="markUnreviewable(item)">Mark unreviewable</button>
          </li>
        </ul>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.loading {
  display: flex;
  justify-content: center;
  padding: 30px;
}
.detail {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
h3 {
  margin: 0 0 6px;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.muted {
  color: var(--mt-muted);
  font-size: 12.5px;
  margin: 4px 0 0;
}
.instructions {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  font-size: 13px;
  white-space: pre-wrap;
}
.bar {
  height: 8px;
  border-radius: 999px;
  background: var(--mt-soft);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: var(--mt-accent);
}
.req-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.plain {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.plain li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft);
  font-size: 12.5px;
}
.items {
  max-height: 260px;
  overflow: auto;
}
.pill {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mt-card);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
}
.pill.completed {
  color: var(--mt-ok-ink, var(--mt-accent));
}
.pill.warn,
.pill.skipped,
.pill.negative {
  color: var(--mt-err-ink);
}
.pill.positive {
  color: var(--mt-ok-ink, var(--mt-accent));
}
.pill.warning {
  color: #92400e;
}
.text-input {
  box-sizing: border-box;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 12.5px;
  color: var(--mt-ink);
}
.text-input.num {
  width: 64px;
}
.small-btn {
  margin-left: auto;
  height: 26px;
  padding: 0 10px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
.req-row .small-btn {
  margin-left: 0;
}
.small-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
