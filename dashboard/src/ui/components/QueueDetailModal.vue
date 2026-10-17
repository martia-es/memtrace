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
import LoadingState from "./LoadingState.vue";
import TabBar from "./TabBar.vue";
import { t } from "../i18n";

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
const TABS: Array<{ id: Tab; label: string }> = [{ id: "summary", get label() { return t("queueDetailModal.summary"); } }, { id: "results", get label() { return t("queueDetailModal.results"); } }, { id: "settings", get label() { return t("common.settings"); } }];
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
    .catch((error) => notifyError(t("queueDetailModal.could_not_load_members"), error));
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
    notifyError(t("queueDetailModal.could_not_update_the_reviewers"), error);
  }
}

async function saveRequired() {
  if (required.value === null) return;
  try {
    await api.updateAnnotationQueue(props.queueId, { requiredAnnotations: required.value });
    required.value = null;
    await reload();
  } catch (error) {
    notifyError(t("queueDetailModal.could_not_update_the_queue"), error);
  }
}

async function markUnreviewable(item: QueueItemDto) {
  try {
    await api.markAnnotationQueueItemUnreviewable(props.queueId, item.id);
    await reload();
  } catch (error) {
    notifyError(t("queueDetailModal.could_not_mark_the_item"), error);
  }
}

const label = (item: QueueItemDto) => (item.targetType === "trace" ? t("queueDetailModal.trace_id", { id: shortId(item.traceId ?? "") }) : t("queueDetailModal.run_id_item_index", { id: shortId(item.datasetRunId ?? ""), index: item.itemIndex }));
</script>

<template>
  <Modal :title="detail.data.value?.name ?? t('queueDetailModal.queue')" wide @close="emit('close')">
    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="detail.run()" />
    <LoadingState v-else-if="!detail.data.value" size="md" />

    <div v-else class="detail" data-testid="queue-detail">
      <p v-if="detail.data.value.instructions" class="instructions">{{ detail.data.value.instructions }}</p>

      <TabBar v-if="canManage" :tabs="TABS" :model-value="tab" @update:model-value="tab = $event as Tab" />

      <QueueResults v-if="canManage && tab === 'results'" :queue-id="queueId" @close="emit('close')" />

      <section v-if="showSummary">
        <h3>{{ t("queueDetailModal.progress") }}</h3>
        <div class="bar" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100"><div class="fill" :style="{ width: `${percent}%` }" /></div>
        <p class="muted">
          {{ t("queueDetailModal.completed_completed_pending_pending_skip", { completed: detail.data.value.progress.completed, pending: detail.data.value.progress.pending, skipped: detail.data.value.progress.skipped }) }}
        </p>
        <p v-if="!canManage" class="muted">{{ t("queueDetailModal.reviews_required_per_item") + " " }}<strong>{{ detail.data.value.requiredAnnotations }}</strong></p>
      </section>

      <section v-if="canManage && showSettings">
        <h3>{{ t("queueDetailModal.reviews_required_per_item2") }}</h3>
        <div class="req-row">
          <TextInput
            :model-value="required ?? detail.data.value.requiredAnnotations"
            type="number"
            min="1"
            max="10"
            :aria-label="t('queueDetailModal.reviews_required_per_item2')"
            @input="required = Number(($event.target as HTMLInputElement).value)" />
          <Button size="sm" :disabled="required === null || required === detail.data.value.requiredAnnotations" @click="saveRequired">{{ t("queueDetailModal.apply") }}</Button>
        </div>
        <p class="muted">{{ t("queueDetailModal.raising_it_reopens_items_that_were") }}</p>
      </section>

      <section v-if="showSettings">
        <h3>{{ t("queueDetailModal.rubric") }}</h3>
        <ul class="plain">
          <li v-for="c in detail.data.value.configs" :key="c.id">
            <strong>{{ c.name }}</strong> <span class="muted">{{ describeScale(c) }}</span>
            <Pill v-if="detail.data.value.rubric.find((r) => r.configId === c.id)?.required">{{ t("queueDetailModal.required") }}</Pill>
            <Pill v-if="c.archivedAt" tone="warn">{{ t("queueDetailModal.archived") }}</Pill>
          </li>
        </ul>
      </section>

      <section v-if="canManage && showSettings">
        <h3>{{ t("queueDetailModal.who_can_annotate") }}</h3>
        <p class="muted">{{ t("queueDetailModal.only_these_people_can_pull_and") }}</p>
        <Checkbox v-for="m in members" :key="m.userId" class="req-row" :model-value="currentReviewers" :value="m.userId" @update:model-value="assigned = $event as string[]"> {{ m.name ?? m.email }} <span class="muted">{{ m.email }}</span></Checkbox>
        <Button size="sm" :disabled="!reviewersChanged || !currentReviewers.length" @click="saveReviewers">{{ t("queueDetailModal.apply") }}</Button>
        <p v-if="currentReviewers.length < detail.data.value.requiredAnnotations" class="muted">{{ t("queueDetailModal.at_least_count_reviewers_are_needed", { count: detail.data.value.requiredAnnotations }) }}</p>
      </section>

      <section v-if="showSummary">
        <h3>{{ t("queueDetailModal.progress_by_reviewer") }}</h3>
        <p v-if="!detail.data.value.reviewers.length" class="muted">{{ t("queueDetailModal.nobody_has_started_reviewing_yet") }}</p>
        <ul v-else class="plain">
          <li v-for="r in detail.data.value.reviewers" :key="r.userId" data-testid="reviewer-row">
            <strong>{{ r.name ?? t("queueDetailModal.former_member") }}</strong>
            <span class="muted">{{ t("queueDetailModal.done_done_skipped_skipped_inprogress_in", { done: r.completed, skipped: r.skipped, inProgress: r.inProgress }) }}</span>
          </li>
        </ul>
      </section>

      <section v-if="showSummary">
        <h3>{{ t("queueDetailModal.agreement_between_reviewers") }}</h3>
        <InterAnnotatorAgreement :queue-id="queueId" />
      </section>

      <section v-if="showSummary && hasRunItems && judgeMetrics.length" data-testid="queue-verdict">
        <h3>{{ t("queueDetailModal.judge_verdict") }}</h3>
        <ul class="plain">
          <li v-for="m in judgeMetrics" :key="m.name">
            <strong>{{ m.name }}</strong>
            <Pill :tone="aggregatePillTone(judgeVerdict(m.kappa).tone)">{{ judgeVerdict(m.kappa).text }}</Pill>
          </li>
        </ul>
      </section>

      <JudgeHumanAgreement v-if="showSummary && hasRunItems" :scope="{ queueId }" />

      <section v-if="showSettings">
        <h3>{{ t("queueDetailModal.items") }}</h3>
        <p v-if="!(items.data.value?.items.length ?? 0)" class="muted">{{ t("queueDetailModal.the_queue_is_empty_add_traces") }}</p>
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
            <Pill :tone="item.status === 'completed' ? 'ok' : item.status === 'skipped' ? 'warn' : 'neutral'">{{ item.status === "skipped" ? t("queueDetailModal.unreviewable") : item.status }}</Pill>
            <Button class="push" size="sm" v-if="canManage && item.status !== 'skipped'" @click="markUnreviewable(item)">{{ t("queueDetailModal.mark_unreviewable") }}</Button>
          </li>
        </ul>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
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
