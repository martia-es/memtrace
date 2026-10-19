<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../components/Select.vue";
import SegmentedControl from "../components/SegmentedControl.vue";
import { computed, inject, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { AnnotationQueueSummaryDto, ReviewerCandidatesResponse, ScoreConfigDto } from "@contract";
import { hasPermission } from "../composables/usePermissions";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import PageHeader from "../components/PageHeader.vue";
import QueueDetailModal from "../components/QueueDetailModal.vue";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "../components/Button.vue";
import Checkbox from "../components/Checkbox.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";
import Menu from "../components/Menu.vue";
import MenuItem from "../components/MenuItem.vue";
import { t, tp } from "../i18n";

/**
 * Colas de revisión (ADR-039): qué trazas hay que revisar, con qué rúbrica y cuánto va hecho. Cualquier
 * miembro puede revisar y añadir trazas; solo los admins crean, archivan y retiran items del reparto.
 */
const ICON = "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2zM9 14l2 2 4-4";

const api = useTraceApi();
const identityApi = useIdentityApi();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const experimentId = computed(() => route.params.experimentId as string);
const currentExperiment = inject(CURRENT_EXPERIMENT, computed(() => null));
const canManage = computed(() => hasPermission(currentExperiment.value, "queue:manage"));
const canCurate = computed(() => hasPermission(currentExperiment.value, "queue:curate"));

// se piden también las archivadas: alimentan la pestaña "Archived"
const queues = useAsync((signal) => api.listAnnotationQueues(true, signal));
void queues.run();
// nombres de la rúbrica para las etiquetas de cada fila; si no cargan, la fila simplemente no las muestra
const scoreConfigs = useAsync(() => identityApi.listScoreConfigs(experimentId.value));
void scoreConfigs.run();
const rubricNames = (q: AnnotationQueueSummaryDto) =>
  q.rubric.map((r) => scoreConfigs.data.value?.find((c) => c.id === r.configId)?.name).filter((n): n is string => !!n);

// una sola pantalla (ADR-059): el alcance y el estado son filtros guardados en la URL, así se pueden compartir y recargar
type Scope = "assigned" | "all";
type Status = "active" | "archived";
const scope = computed<Scope>({
  get: () => (route.query.scope === "all" ? "all" : "assigned"),
  set: (v) => void router.replace({ query: { ...route.query, scope: v === "all" ? "all" : undefined } }),
});
const status = computed<Status>({
  get: () => (route.query.status === "archived" ? "archived" : "active"),
  set: (v) => void router.replace({ query: { ...route.query, status: v === "archived" ? "archived" : undefined } }),
});

function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
}

const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const total = (q: AnnotationQueueSummaryDto) => q.progress.pending + q.progress.completed + q.progress.skipped;

// Colas con trabajo pendiente primero, para que el reviewer vea de un vistazo dónde tiene que ir.
const sortedQueues = computed(() =>
  [...(queues.data.value?.items ?? [])]
    .filter((q) => !q.archivedAt)
    .sort((a, b) => Number(b.progress.pending > 0) - Number(a.progress.pending > 0)),
);
const archivedQueues = computed(() => (queues.data.value?.items ?? []).filter((q) => q.archivedAt));
const visibleQueues = computed(() => {
  const base = status.value === "archived" ? archivedQueues.value : sortedQueues.value;
  return scope.value === "assigned" ? base.filter((q) => q.isReviewer) : base;
});

// solo cuenta lo que YO puedo revisar (ADR-051): una cola donde no estoy en la lista no es trabajo mío
const pendingTotal = computed(() => sortedQueues.value.filter((q) => q.isReviewer).reduce((n, q) => n + q.progress.pending, 0));
const pendingQueues = computed(() => sortedQueues.value.filter((q) => q.isReviewer && q.progress.pending > 0));
// trabajo del perfil técnico (admin): items que los revisores ya terminaron y aún no están en ningún dataset
const curateQueues = computed(() => (canCurate.value ? sortedQueues.value.filter((q) => q.toCurate > 0) : []));
const curateTotal = computed(() => curateQueues.value.reduce((n, q) => n + q.toCurate, 0));
const percent = (q: AnnotationQueueSummaryDto) => Math.round((q.progress.completed / Math.max(1, total(q))) * 100);
const continueReviewing = () => {
  const first = pendingQueues.value[0];
  if (first) review(first.id);
};
const review = (queueId: string) => void router.push({ name: "annotation-queue-review", params: { experimentId: experimentId.value, queueId } });

// ---- details ----
const detailQueueId = ref<string | null>(null);
const detailTab = ref<"summary" | "results">("summary");
function openDetail(queueId: string, tab: "summary" | "results" = "summary") {
  detailTab.value = tab;
  detailQueueId.value = queueId;
}

// ---- create ----
const showCreate = ref(false);
const configs = ref<ScoreConfigDto[]>([]);
const members = ref<ReviewerCandidatesResponse["candidates"]>([]);
const form = reactive({ name: "", instructions: "", requiredAnnotations: 1, reviewerIds: [] as string[], picked: {} as Record<string, { on: boolean; required: boolean }> });
const creating = ref(false);
const rubric = computed(() => Object.entries(form.picked).filter(([, v]) => v.on).map(([configId, v]) => ({ configId, required: v.required })));

async function openCreate() {
  showCreate.value = true;
  try {
    members.value = (await api.listReviewerCandidates()).candidates;
    configs.value = await identityApi.listScoreConfigs(experimentId.value);
    for (const c of configs.value) form.picked[c.id] ??= { on: false, required: true };
  } catch (error) {
    notifyError(t("annotationQueuesPage.could_not_load_members_or_score"), error);
  }
}

async function create() {
  creating.value = true;
  try {
    await api.createAnnotationQueue({
      name: form.name.trim(),
      instructions: form.instructions.trim() || null,
      requiredAnnotations: form.requiredAnnotations,
      reviewerIds: form.reviewerIds,
      rubric: rubric.value,
    });
    showCreate.value = false;
    Object.assign(form, { name: "", instructions: "", requiredAnnotations: 1, reviewerIds: [], picked: {} });
    await queues.run();
  } catch (error) {
    notifyError(t("annotationQueuesPage.could_not_create_the_queue"), error);
  } finally {
    creating.value = false;
  }
}

async function setArchived(queue: AnnotationQueueSummaryDto, archived: boolean) {
  try {
    await api.updateAnnotationQueue(queue.id, { archived });
    await queues.run();
  } catch (error) {
    notifyError(archived ? t("annotationQueuesPage.could_not_archive_the_queue") : t("annotationQueuesPage.could_not_restore_the_queue"), error);
  }
}

// ---- add traces matching a filter (a snapshot: the queue keeps ids, it is not a live search) ----
const addTo = ref<AnnotationQueueSummaryDto | null>(null);
const filter = reactive({ status: "" as "" | "ok" | "error", hasErrors: false, minDurationMs: null as number | null, hours: 24, limit: 100, random: false });
const adding = ref(false);

async function addByFilter() {
  if (!addTo.value) return;
  adding.value = true;
  try {
    const to = new Date();
    const from = new Date(to.getTime() - filter.hours * 3_600_000);
    const result = await api.addAnnotationQueueItems(addTo.value.id, {
      fromFilter: {
        from: from.toISOString(),
        to: to.toISOString(),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.hasErrors ? { hasErrors: true } : {}),
        ...(filter.minDurationMs ? { minDurationMs: filter.minDurationMs } : {}),
        ...(filter.random ? { sample: { size: filter.limit } } : { limit: filter.limit }),
      },
    });
    const note = result.sample?.truncated ? ` ${t("annotationQueuesPage.sampled_from_the_count_most_recent", { count: result.sample.poolSize })}` : "";
    $q.notify({ message: `${t("annotationQueuesPage.count_added", { count: result.added })}${result.duplicates ? `, ${t("annotationQueuesPage.count_already_in_the_queue", { count: result.duplicates })}` : ""}${note}`, color: "positive", timeout: 3500 });
    addTo.value = null;
    await queues.run();
  } catch (error) {
    notifyError(t("annotationQueuesPage.could_not_add_traces"), error);
  } finally {
    adding.value = false;
  }
}
const STATUS_OPTIONS: { label: string; value: "" | "ok" | "error" }[] = [
  { get label() { return t("annotationQueuesPage.any"); }, value: "" },
  { get label() { return t("annotationQueuesPage.ok"); }, value: "ok" },
  { get label() { return t("annotationQueuesPage.error"); }, value: "error" },
];
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: t('nav.review') }]" :icon="ICON" :title="t('nav.review')">
      <Button variant="primary" v-if="canManage" data-testid="new-queue" @click="openCreate" class="mt-new">{{ t("annotationQueuesPage.new_queue") }}</Button>
    </PageHeader>

    <div class="filters">
      <SegmentedControl v-model="scope" :aria-label="t('annotationQueuesPage.queues_to_show')" :options="[{ value: 'assigned', label: t('annotationQueuesPage.scope_assigned'), testid: 'scope-assigned' }, { value: 'all', label: t('annotationQueuesPage.scope_all'), testid: 'scope-all' }]" />
      <SegmentedControl v-model="status" :aria-label="t('annotationQueuesPage.queue_status')" :options="[{ value: 'active', label: t('annotationQueuesPage.status_active'), testid: 'status-active' }, { value: 'archived', label: t('annotationQueuesPage.status_archived'), testid: 'status-archived' }]" />
    </div>

    <section v-if="pendingTotal > 0" class="inbox" data-testid="inbox">
      <div class="inbox-text">
        <span class="eyebrow">{{ t("annotationQueuesPage.your_review_inbox") }}</span>
        <h2>{{ tp("annotationQueuesPage.waiting", pendingTotal) }}</h2>
        <p>{{ t("annotationQueuesPage.across_queues_nobody_gets_the_same", { queues: tp("annotationQueuesPage.queuesCount", pendingQueues.length) }) }}</p>
      </div>
      <Button data-testid="continue-reviewing" @click="continueReviewing">{{ t("annotationQueuesPage.continue_reviewing") }}</Button>
    </section>
    <section v-if="curateTotal > 0" class="inbox curate" data-testid="curate-inbox">
      <div class="inbox-text">
        <span class="eyebrow">{{ t("annotationQueuesPage.ready_for_you") }}</span>
        <h2>{{ tp("annotationQueuesPage.curate", curateTotal) }}</h2>
        <p>{{ tp("annotationQueuesPage.curateNote", curateTotal, { queues: tp("annotationQueuesPage.queuesCount", curateQueues.length) }) }}</p>
      </div>
      <Button data-testid="open-results" @click="openDetail(curateQueues[0]!.id, 'results')">{{ t("annotationQueuesPage.open_results") }}</Button>
    </section>

    <p v-if="pendingTotal === 0 && curateTotal === 0 && queues.data.value?.items.length" class="hint muted">{{ t("annotationQueuesPage.you_are_all_caught_up") }}</p>

    <ErrorBanner v-if="queues.error.value" :error="queues.error.value" @retry="queues.run()" />
    <LoadingState v-else-if="queues.loading.value && !queues.data.value" size="lg" />
    <EmptyState v-else-if="(queues.data.value?.items.length ?? 0) === 0" icon="rate_review" :title="t('annotationQueuesPage.no_review_queues_yet')">
      {{ canManage ? t("annotationQueuesPage.create_one_with_new_queue_you") : t("annotationQueuesPage.ask_an_experiment_admin_to_create") }}
    </EmptyState>
    <p v-else-if="visibleQueues.length === 0" class="hint muted" data-testid="queues-empty-tab">
      {{ status === "archived" ? t("annotationQueuesPage.no_archived_queues") : scope === "assigned" ? t("annotationQueuesPage.you_are_not_assigned_to_any") : t("annotationQueuesPage.you_are_all_caught_up") }}
    </p>

    <Card padding="none" block v-if="visibleQueues.length" class="table-card">
      <div class="grid head">
        <span>{{ t("annotationQueuesPage.queue") }}</span>
        <span>{{ t("annotationQueuesPage.rubric") }}</span>
        <span>{{ t("annotationQueuesPage.progress") }}</span>
        <span>{{ t("annotationQueuesPage.reviewers") }}</span>
        <span />
      </div>
      <div v-for="q in visibleQueues" :key="q.id" class="grid row" data-testid="queue-row" :class="{ 'has-work': q.progress.pending > 0 && !q.archivedAt }">
        <div class="queue-cell">
          <span class="name">{{ q.name }}</span>
          <span v-if="q.instructions" class="desc">{{ q.instructions }}</span>
        </div>
        <div class="chips">
          <span v-for="n in rubricNames(q)" :key="n" class="chip">{{ n }}</span>
        </div>
        <div class="progress-cell">
          <div class="progress-top">
            <span class="done-count">{{ t('annotationQueuesPage.done_of_total', { done: q.progress.completed, total: total(q) }) }}</span>
            <span class="state" :class="{ done: q.progress.pending === 0 }" data-testid="queue-pending">{{ q.progress.pending > 0 ? t("annotationQueuesPage.pending_count", { count: q.progress.pending }) : t("annotationQueuesPage.state_done") }}</span>
          </div>
          <div class="bar" aria-hidden="true"><div class="bar-fill" :class="{ complete: q.progress.pending === 0 }" :style="{ width: `${percent(q)}%` }" /></div>
          <span v-if="canCurate && q.toCurate > 0" class="curate-note" data-testid="queue-to-curate">{{ t("annotationQueuesPage.count_to_review_add_to_a", { count: q.toCurate }) }}</span>
        </div>
        <div class="avatars" data-testid="queue-reviewers">
          <span v-for="r in q.assignedReviewers" :key="r.userId" class="avatar" :title="r.name ?? t('annotationQueuesPage.former_member')" :aria-label="r.name ?? t('annotationQueuesPage.former_member')" data-testid="queue-reviewer">
            <img v-if="r.image" :src="r.image" :alt="r.name ?? t('annotationQueuesPage.former_member')" referrerpolicy="no-referrer" />
            <span v-else>{{ initials(r.name) }}</span>
          </span>
        </div>
        <div class="actions">
          <Button variant="primary" size="sm" v-if="q.isReviewer && q.progress.pending > 0 && !q.archivedAt" @click="review(q.id)">{{ t("annotationQueuesPage.review") }}</Button>
          <Button size="sm" v-else-if="canCurate && !q.archivedAt" data-testid="queue-results-btn" @click="openDetail(q.id, 'results')">{{ t("annotationQueuesPage.view_results") }}</Button>
          <Button size="sm" v-else @click="openDetail(q.id)">{{ t("annotationQueuesPage.details") }}</Button>
          <Button variant="icon" size="sm" class="more" :aria-label="t('annotationQueuesPage.more_actions')" data-testid="queue-more">
            ⋯
            <Menu auto-close anchor="bottom right" self="top right" :offset="[0, 6]" class="queue-menu">
              <div class="menu-list">
                <MenuItem v-if="!q.archivedAt" @click="addTo = q">{{ t("annotationQueuesPage.add_traces") }}</MenuItem>
                <MenuItem v-if="canCurate && q.toCurate > 0" @click="openDetail(q.id, 'results')">{{ t("annotationQueuesPage.review_results") }}</MenuItem>
                <MenuItem @click="openDetail(q.id)">{{ t("annotationQueuesPage.details") }}</MenuItem>
                <MenuItem v-if="canManage && !q.archivedAt" @click="setArchived(q, true)">{{ t("annotationQueuesPage.archive") }}</MenuItem>
                <MenuItem v-if="canManage && q.archivedAt" @click="setArchived(q, false)">{{ t("annotationQueuesPage.restore") }}</MenuItem>
              </div>
            </Menu>
          </Button>
        </div>
      </div>
    </Card>
    <p class="footnote muted">{{ t("annotationQueuesPage.a_queue_is_a_batch_of") }}</p>

    <QueueDetailModal v-if="detailQueueId" :queue-id="detailQueueId" :can-manage="canManage" :initial-tab="detailTab" @close="detailQueueId = null" @changed="queues.run()" />

    <Modal v-if="showCreate" :title="t('annotationQueuesPage.new_review_queue')" @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <TextInput v-model="form.name" :placeholder="t('annotationQueuesPage.queue_name')" maxlength="200" :aria-label="t('annotationQueuesPage.queue_name')" />
        <TextInput multiline v-model="form.instructions" :placeholder="t('annotationQueuesPage.instructions_for_reviewers_optional')" maxlength="5000" :aria-label="t('annotationQueuesPage.instructions')" />
        <label class="inline">
          {{ t("annotationQueuesPage.reviews_required_per_item") }}
          <TextInput v-model="form.requiredAnnotations" type="number" min="1" max="10" :aria-label="t('annotationQueuesPage.reviews_required_per_item')" />
        </label>
        <fieldset class="rubric">
          <legend>{{ t("annotationQueuesPage.reviewers") }}</legend>
          <p class="muted">{{ t("annotationQueuesPage.only_the_people_you_pick_can") }}</p>
          <p v-if="!members.length" class="muted">{{ t("annotationQueuesPage.this_experiment_has_no_members_yet") }}</p>
          <div v-for="m in members" :key="m.userId" class="rubric-row">
            <Checkbox v-model="form.reviewerIds" :value="m.userId"> {{ m.name ?? m.email }} <span class="muted">{{ m.email }}</span></Checkbox>
          </div>
        </fieldset>
        <fieldset class="rubric">
          <legend>{{ t("annotationQueuesPage.rubric") }}</legend>
          <p v-if="!configs.length" class="muted">{{ t("annotationQueuesPage.no_score_configs_yet_create_them") }}</p>
          <div v-for="c in configs" :key="c.id" class="rubric-row">
            <Checkbox v-model="form.picked[c.id]!.on"> {{ c.name }}</Checkbox>
            <Checkbox v-if="form.picked[c.id]?.on" class="muted" v-model="form.picked[c.id]!.required">{{ " " + t("annotationQueuesPage.required") }}</Checkbox>
          </div>
        </fieldset>
        <Button variant="primary" type="submit" :disabled="creating || !form.name.trim() || !rubric.length || !form.reviewerIds.length || form.requiredAnnotations > form.reviewerIds.length">{{ t("annotationQueuesPage.create") }}</Button>
      </form>
    </Modal>

    <Modal v-if="addTo" :title="t('annotationQueuesPage.add_traces_to_name', { name: addTo.name })" @close="addTo = null">
      <form class="modal-form" @submit.prevent="addByFilter">
        <p class="muted">{{ t("annotationQueuesPage.adds_the_traces_that_match") + " " }}<em>{{ t("annotationQueuesPage.now") }}</em>{{ t("annotationQueuesPage.the_queue_keeps_their_ids_it") }}</p>
        <label class="inline">{{ t("annotationQueuesPage.last") + " " }}<TextInput v-model="filter.hours" type="number" min="1" max="720" :aria-label="t('annotationQueuesPage.hours2')" />{{ " " + t("annotationQueuesPage.hours") }}</label>
        <label class="inline">
          {{ t("annotationQueuesPage.root_status") }}
          <Select v-model="filter.status" :options="STATUS_OPTIONS" :aria-label="t('annotationQueuesPage.root_status')" />
        </label>
        <Checkbox class="inline" v-model="filter.hasErrors">{{ " " + t("annotationQueuesPage.only_traces_with_a_failed_span") }}</Checkbox>
        <label class="inline">{{ t("annotationQueuesPage.slower_than_ms") + " " }}<TextInput v-model="filter.minDurationMs" type="number" min="0" :aria-label="t('annotationQueuesPage.minimum_duration')" /></label>
        <label class="inline">{{ filter.random ? t("annotationQueuesPage.sample_of") : t("annotationQueuesPage.at_most") }} <TextInput v-model="filter.limit" type="number" min="1" max="500" :aria-label="t('annotationQueuesPage.limit')" />{{ " " + t("annotationQueuesPage.traces") }}</label>
        <Checkbox class="inline" v-model="filter.random" :aria-label="t('annotationQueuesPage.random_sample')">{{ " " + t("annotationQueuesPage.pick_them_at_random_from_all") }}</Checkbox>
        <Button variant="primary" type="submit" :disabled="adding">{{ t("annotationQueuesPage.add_traces") }}</Button>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 24px;
  background: var(--mt-bg);
}
.hint {
  margin: 0;
  font-size: 12.5px;
}
.muted {
  color: var(--mt-muted);
}
.inbox {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 18px 22px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.inbox-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.eyebrow {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  opacity: 0.8;
}
.inbox h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.inbox p {
  margin: 0;
  opacity: 0.9;
}
.curate-note {
  display: inline-flex;
  margin-top: 2px;
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-size: 11.5px;
  font-weight: 700;
  width: fit-content;
}
.inbox.curate {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.table-card {
  flex: none;
  overflow: hidden;
  padding: 0;
}
.grid {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.2fr) minmax(0, 1.3fr) 90px 150px;
  gap: 16px;
  align-items: center;
  padding: 0 18px;
}
.grid.head {
  height: 34px;
  background: var(--mt-soft);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.grid.row {
  min-height: 72px;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--mt-line-2);
}
.grid.row.has-work {
  box-shadow: inset 3px 0 0 var(--mt-highlight);
}
.queue-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.desc {
  overflow: hidden;
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: flex;
  align-items: center;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
  font-size: 11.5px;
  font-weight: 700;
}
.progress-cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.progress-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.done-count,
.state {
  font-weight: 700;
}
.state {
  color: var(--mt-muted);
}
.state.done {
  color: var(--mt-ok-ink);
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--mt-line-2);
}
.bar-fill {
  height: 6px;
  border-radius: 3px;
  background: var(--mt-accent);
}
.bar-fill.complete {
  background: var(--mt-ok);
}
.avatars {
  display: flex;
}
.avatar {
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  overflow: hidden;
  border-radius: 50%;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  border: 2px solid var(--mt-card);
  margin-left: -6px;
  font-size: 10px;
  font-weight: 800;
  box-sizing: border-box;
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar:first-child {
  margin-left: 0;
}
.name {
  font-weight: 800;
  font-size: 14px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.more {
  height: 32px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-accent-text);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}
.more {
  width: 32px;
  padding: 0;
  color: var(--mt-muted);
}
.menu-list {
  display: flex;
  flex-direction: column;
  min-width: 160px;
  padding: 4px;
}

.footnote {
  max-width: 760px;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.inline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.rubric {
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rubric legend {
  padding: 0 6px;
  color: var(--mt-muted);
  font-size: 12px;
}
.rubric-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

</style>
