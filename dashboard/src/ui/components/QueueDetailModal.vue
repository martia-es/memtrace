<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { useRoute } from "vue-router";
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import type { QueueItemDto, ReviewerCandidatesResponse } from "@contract";
import { shortId } from "@/domain/format";
import { judgeVerdict } from "@/domain/agreement";
import { describeScale } from "../score-config-form";
import ErrorBanner from "./ErrorBanner.vue";
import InterAnnotatorAgreement from "./InterAnnotatorAgreement.vue";
import JudgeHumanAgreement from "./JudgeHumanAgreement.vue";
import Modal from "./Modal.vue";
import QueueResults from "./QueueResults.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";
import Pill from "./Pill.vue";
import { aggregatePillTone } from "@/domain/evaluation";

/** Progreso, trabajo por revisor, rúbrica y items de una cola (ADR-039). Los admins pueden cambiar `requiredAnnotations` y retirar items del reparto. */
const props = defineProps<{ queueId: string; canManage: boolean; initialTab?: "summary" | "results" | "settings" }>();
const emit = defineEmits<{ close: []; changed: [] }>();

const api = useTraceApi();
const route = useRoute();
const $q = useQuasar();
const experimentId = computed(() => route.params.experimentId as string);

const detail = useAsync((signal) => api.getAnnotationQueue(props.queueId, signal));
const items = useAsync((signal) => api.listAnnotationQueueItems(props.queueId, undefined, signal));
void detail.run();
void items.run();

const hasRunItems = computed(() => items.data.value?.items.some((i) => i.targetType === "run_item") ?? false);
const judgeAgreement = useAsync((signal) => api.getJudgeHumanAgreement({ queueId: props.queueId }, undefined, signal));
void judgeAgreement.run();
const judgeMetrics = computed(() => judgeAgreement.data.value?.metrics ?? []);
const required = ref<number | null>(null);
// el perfil técnico (admin) trabaja por pestañas (ADR-050); quien solo revisa ve el resumen de siempre
type Tab = "summary" | "results" | "settings";
const TABS: Array<{ id: Tab; label: string }> = [{ id: "summary", label: "Summary" }, { id: "results", label: "Results" }, { id: "settings", label: "Settings" }];
const tab = ref<Tab>(props.initialTab ?? "summary");
const showSummary = computed(() => !props.canManage || tab.value === "summary");
const showSettings = computed(() => !props.canManage || tab.value === "settings");
// quién puede anotar (ADR-051): solo los admins ven y editan la lista
const members = ref<ReviewerCandidatesResponse["candidates"]>([]);
const assigned = ref<string[] | null>(null);
if (props.canManage) {
  api
    .listReviewerCandidates()
    .then((r) => (members.value = r.candidates))
    .catch((error) => notifyError("Could not load members", error));
}
const currentReviewers = computed(() => assigned.value ?? detail.data.value?.reviewerIds ?? []);
const reviewersChanged = computed(() => {
  const saved = detail.data.value?.reviewerIds ?? [];
  return assigned.value !== null && (assigned.value.length !== saved.length || assigned.value.some((id) => !saved.includes(id)));
});
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

async function saveReviewers() {
  if (assigned.value === null) return;
  try {
    await api.updateAnnotationQueue(props.queueId, { reviewerIds: assigned.value });
    assigned.value = null;
    await reload();
  } catch (error) {
    notifyError("Could not update the reviewers", error);
  }
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

      <nav v-if="canManage" class="tabs" role="tablist" aria-label="Queue sections">
        <button v-for="t in TABS" :key="t.id" type="button" role="tab" class="tab" :class="{ on: tab === t.id }" :aria-selected="tab === t.id" :data-testid="`tab-${t.id}`" @click="tab = t.id">{{ t.label }}</button>
      </nav>

      <QueueResults v-if="canManage && tab === 'results'" :queue-id="queueId" @close="emit('close')" />

      <section v-if="showSummary">
        <h3>Progress</h3>
        <div class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100"><div class="fill" :style="{ width: `${percent}%` }" /></div>
        <p class="muted">
          {{ detail.data.value.progress.completed }} completed · {{ detail.data.value.progress.pending }} pending · {{ detail.data.value.progress.skipped }} unreviewable
        </p>
        <p v-if="!canManage" class="muted">Reviews required per item: <strong>{{ detail.data.value.requiredAnnotations }}</strong></p>
      </section>

      <section v-if="canManage && showSettings">
        <h3>Reviews required per item</h3>
        <div class="req-row">
          <TextInput
            :model-value="required ?? detail.data.value.requiredAnnotations"
            type="number"
            min="1"
            max="10"
            aria-label="Reviews required per item"
            @input="required = Number(($event.target as HTMLInputElement).value)" />
          <Button size="sm" :disabled="required === null || required === detail.data.value.requiredAnnotations" @click="saveRequired">Apply</Button>
        </div>
        <p class="muted">Raising it reopens items that were already completed; lowering it can complete them.</p>
      </section>

      <section v-if="showSettings">
        <h3>Rubric</h3>
        <ul class="plain">
          <li v-for="c in detail.data.value.configs" :key="c.id">
            <strong>{{ c.name }}</strong> <span class="muted">{{ describeScale(c) }}</span>
            <Pill v-if="detail.data.value.rubric.find((r) => r.configId === c.id)?.required">required</Pill>
            <Pill v-if="c.archivedAt" tone="warn">archived</Pill>
          </li>
        </ul>
      </section>

      <section v-if="canManage && showSettings">
        <h3>Who can annotate</h3>
        <p class="muted">Only these people can pull and label items. Removing someone keeps what they already labeled.</p>
        <Checkbox v-for="m in members" :key="m.userId" class="req-row" :model-value="currentReviewers" :value="m.userId" @update:model-value="assigned = $event as string[]"> {{ m.name ?? m.email }} <span class="muted">{{ m.email }}</span></Checkbox>
        <Button size="sm" :disabled="!reviewersChanged || !currentReviewers.length" @click="saveReviewers">Apply</Button>
        <p v-if="currentReviewers.length < detail.data.value.requiredAnnotations" class="muted">At least {{ detail.data.value.requiredAnnotations }} reviewers are needed.</p>
      </section>

      <section v-if="showSummary">
        <h3>Progress by reviewer</h3>
        <p v-if="!detail.data.value.reviewers.length" class="muted">Nobody has started reviewing yet.</p>
        <ul v-else class="plain">
          <li v-for="r in detail.data.value.reviewers" :key="r.userId" data-testid="reviewer-row">
            <strong>{{ r.name ?? "Former member" }}</strong>
            <span class="muted">{{ r.completed }} done · {{ r.skipped }} skipped · {{ r.inProgress }} in progress</span>
          </li>
        </ul>
      </section>

      <section v-if="showSummary">
        <h3>Agreement between reviewers</h3>
        <InterAnnotatorAgreement :queue-id="queueId" />
      </section>

      <section v-if="showSummary && hasRunItems && judgeMetrics.length" data-testid="queue-verdict">
        <h3>Judge verdict</h3>
        <ul class="plain">
          <li v-for="m in judgeMetrics" :key="m.name">
            <strong>{{ m.name }}</strong>
            <Pill :tone="aggregatePillTone(judgeVerdict(m.kappa).tone)">{{ judgeVerdict(m.kappa).text }}</Pill>
          </li>
        </ul>
      </section>

      <JudgeHumanAgreement v-if="showSummary && hasRunItems" :scope="{ queueId }" />

      <section v-if="showSettings">
        <h3>Items</h3>
        <p v-if="!(items.data.value?.items.length ?? 0)" class="muted">The queue is empty. Add traces from this page or from a trace's detail.</p>
        <ul v-else class="plain items">
          <li v-for="item in items.data.value!.items" :key="item.id" data-testid="queue-item-row">
            <router-link
              v-if="item.targetType === 'trace' && item.traceId"
              :to="{ name: 'trace', params: { experimentId, traceId: item.traceId } }"
              class="item-link mono"
              @click="emit('close')"
            >
              Trace {{ shortId(item.traceId) }}
            </router-link>
            <router-link
              v-else-if="item.targetType === 'run_item' && item.datasetRunId"
              :to="{ name: 'runs', params: { experimentId } }"
              class="item-link mono"
              @click="emit('close')"
            >
              Run {{ shortId(item.datasetRunId) }} · item {{ item.itemIndex }}
            </router-link>
            <span v-else class="mono">{{ label(item) }}</span>
            <Pill :tone="item.status === 'completed' ? 'ok' : item.status === 'skipped' ? 'warn' : 'neutral'">{{ item.status === "skipped" ? "unreviewable" : item.status }}</Pill>
            <Button class="push" size="sm" v-if="canManage && item.status !== 'skipped'" @click="markUnreviewable(item)">Mark unreviewable</Button>
          </li>
        </ul>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--mt-line);
}
.tab {
  padding: 6px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--mt-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.tab.on {
  border-bottom-color: var(--mt-accent);
  color: var(--mt-ink);
}
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

.push { margin-left: auto; }
</style>
