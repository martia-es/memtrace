<script setup lang="ts">
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

const queues = useAsync((signal) => api.listAnnotationQueues(false, signal));
void queues.run();

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
  [...(queues.data.value?.items ?? [])].sort((a, b) => Number(b.progress.pending > 0) - Number(a.progress.pending > 0)),
);

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
    notifyError("Could not load members or score configs", error);
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
    notifyError("Could not create the queue", error);
  } finally {
    creating.value = false;
  }
}

async function archive(queue: AnnotationQueueSummaryDto) {
  try {
    await api.updateAnnotationQueue(queue.id, { archived: true });
    await queues.run();
  } catch (error) {
    notifyError("Could not archive the queue", error);
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
    const note = result.sample?.truncated ? ` (sampled from the ${result.sample.poolSize} most recent matches)` : "";
    $q.notify({ message: `${result.added} added${result.duplicates ? `, ${result.duplicates} already in the queue` : ""}${note}`, color: "positive", timeout: 3500 });
    addTo.value = null;
    await queues.run();
  } catch (error) {
    notifyError("Could not add traces", error);
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Review' }]" :icon="ICON" title="Review">
      <button v-if="canManage" type="button" class="primary-btn" data-testid="new-queue" @click="openCreate">New queue</button>
    </PageHeader>

    <section v-if="pendingTotal > 0" class="inbox" data-testid="inbox">
      <div class="inbox-text">
        <span class="eyebrow">YOUR REVIEW INBOX</span>
        <h2>{{ pendingTotal }} {{ pendingTotal === 1 ? "item is" : "items are" }} waiting for review</h2>
        <p>Across {{ pendingQueues.length }} {{ pendingQueues.length === 1 ? "queue" : "queues" }}. Nobody gets the same item twice, and you can skip anything you are unsure about.</p>
      </div>
      <button type="button" class="inbox-cta" data-testid="continue-reviewing" @click="continueReviewing">Continue reviewing →</button>
    </section>
    <section v-if="curateTotal > 0" class="inbox curate" data-testid="curate-inbox">
      <div class="inbox-text">
        <span class="eyebrow">READY FOR YOU</span>
        <h2>{{ curateTotal }} reviewed {{ curateTotal === 1 ? "item is" : "items are" }} waiting for your decision</h2>
        <p>Reviewers have finished {{ curateTotal === 1 ? "it" : "them" }} in {{ curateQueues.length }} {{ curateQueues.length === 1 ? "queue" : "queues" }}. Check their answers, settle any disagreement and add the good ones to a dataset.</p>
      </div>
      <button type="button" class="inbox-cta" data-testid="open-results" @click="openDetail(curateQueues[0]!.id, 'results')">Open results →</button>
    </section>
    <p v-if="pendingTotal === 0 && curateTotal === 0 && queues.data.value?.items.length" class="hint muted">
      You are all caught up. Queues are batches of traces that people review with a rubric; add traces here by filter or from any trace's detail.
    </p>

    <ErrorBanner v-if="queues.error.value" :error="queues.error.value" @retry="queues.run()" />
    <div v-else-if="queues.loading.value && !queues.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(queues.data.value?.items.length ?? 0) === 0" icon="rate_review" title="No review queues yet">
      {{ canManage ? 'Create one with "New queue" (you need at least one score config first).' : "Ask an experiment admin to create one." }}
    </EmptyState>

    <div v-if="queues.data.value?.items.length" class="mt-card table-card">
      <table>
        <thead>
          <tr>
            <th>Queue</th>
            <th>Progress</th>
            <th>Reviewers</th>
            <th class="num">Reviews / item</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="q in sortedQueues" :key="q.id" data-testid="queue-row" :class="{ 'has-work': q.progress.pending > 0 }">
            <td class="name">{{ q.name }}</td>
            <td class="progress-cell">
              <div class="progress-top">
                <span class="done-count">{{ q.progress.completed }} of {{ total(q) }} reviewed</span>
                <span v-if="q.progress.pending > 0" class="notice work" data-testid="queue-pending">{{ q.progress.pending }} of {{ total(q) }} pending</span>
                <span v-else class="notice done" data-testid="queue-pending">All caught up · {{ total(q) }} reviewed</span>
              </div>
              <span v-if="canCurate && q.toCurate > 0" class="notice curate-note" data-testid="queue-to-curate">{{ q.toCurate }} to review &amp; add to a dataset</span>
              <div class="bar" aria-hidden="true"><div class="bar-fill" :class="{ complete: q.progress.pending === 0 }" :style="{ width: `${percent(q)}%` }" /></div>
            </td>
            <td>
              <div class="avatars" data-testid="queue-reviewers">
                <q-avatar v-for="r in q.assignedReviewers" :key="r.userId" size="28px" class="avatar" color="primary" text-color="white" :aria-label="r.name ?? 'Former member'" data-testid="queue-reviewer">
                  <img v-if="r.image" :src="r.image" :alt="r.name ?? 'Former member'" referrerpolicy="no-referrer" />
                  <span v-else>{{ initials(r.name) }}</span>
                  <q-tooltip>{{ r.name ?? "Former member" }}</q-tooltip>
                </q-avatar>
              </div>
            </td>
            <td class="num mono">{{ q.requiredAnnotations }}</td>
            <td>
              <div class="actions">
                <button v-if="q.isReviewer" type="button" class="small-btn" :class="{ accent: q.progress.pending > 0 }" :disabled="q.progress.pending === 0" @click="review(q.id)">Review</button>
                <button type="button" class="small-btn" @click="addTo = q">Add traces</button>
                <button v-if="canCurate && q.toCurate > 0" type="button" class="small-btn accent" data-testid="queue-results-btn" @click="openDetail(q.id, 'results')">Review results</button>
                <button type="button" class="small-btn" @click="openDetail(q.id)">Details</button>
                <button v-if="canManage" type="button" class="small-btn" @click="archive(q)">Archive</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <QueueDetailModal v-if="detailQueueId" :queue-id="detailQueueId" :can-manage="canManage" :initial-tab="detailTab" @close="detailQueueId = null" @changed="queues.run()" />

    <Modal v-if="showCreate" title="New review queue" @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <input v-model="form.name" class="text-input" placeholder="Queue name" maxlength="200" aria-label="Queue name" />
        <textarea v-model="form.instructions" class="text-input area" placeholder="Instructions for reviewers (optional)" maxlength="5000" aria-label="Instructions" />
        <label class="inline">
          Reviews required per item
          <input v-model.number="form.requiredAnnotations" class="text-input num-input" type="number" min="1" max="10" aria-label="Reviews required per item" />
        </label>
        <fieldset class="rubric">
          <legend>Reviewers</legend>
          <p class="muted">Only the people you pick can annotate in this queue.</p>
          <p v-if="!members.length" class="muted">This experiment has no members yet. Invite them in Admin → your experiment.</p>
          <div v-for="m in members" :key="m.userId" class="rubric-row">
            <label><input v-model="form.reviewerIds" type="checkbox" :value="m.userId" /> {{ m.name ?? m.email }} <span class="muted">{{ m.email }}</span></label>
          </div>
        </fieldset>
        <fieldset class="rubric">
          <legend>Rubric</legend>
          <p v-if="!configs.length" class="muted">No score configs yet. Create them in Admin → your experiment → Score configs.</p>
          <div v-for="c in configs" :key="c.id" class="rubric-row">
            <label><input v-model="form.picked[c.id]!.on" type="checkbox" /> {{ c.name }}</label>
            <label v-if="form.picked[c.id]?.on" class="muted"><input v-model="form.picked[c.id]!.required" type="checkbox" /> required</label>
          </div>
        </fieldset>
        <button type="submit" class="primary-btn" :disabled="creating || !form.name.trim() || !rubric.length || !form.reviewerIds.length || form.requiredAnnotations > form.reviewerIds.length">Create</button>
      </form>
    </Modal>

    <Modal v-if="addTo" :title="`Add traces to “${addTo.name}”`" @close="addTo = null">
      <form class="modal-form" @submit.prevent="addByFilter">
        <p class="muted">Adds the traces that match <em>now</em>; the queue keeps their ids, it does not follow new traffic.</p>
        <label class="inline">Last <input v-model.number="filter.hours" class="text-input num-input" type="number" min="1" max="720" aria-label="Hours" /> hours</label>
        <label class="inline">
          Root status
          <select v-model="filter.status" class="text-input" aria-label="Root status">
            <option value="">Any</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label class="inline"><input v-model="filter.hasErrors" type="checkbox" /> Only traces with a failed span</label>
        <label class="inline">Slower than (ms) <input v-model.number="filter.minDurationMs" class="text-input num-input" type="number" min="0" aria-label="Minimum duration" /></label>
        <label class="inline">{{ filter.random ? "Sample of" : "At most" }} <input v-model.number="filter.limit" class="text-input num-input" type="number" min="1" max="500" aria-label="Limit" /> traces</label>
        <label class="inline"><input v-model="filter.random" type="checkbox" aria-label="Random sample" /> Pick them at random from all matches instead of the first ones</label>
        <button type="submit" class="primary-btn" :disabled="adding">Add traces</button>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
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
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
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
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.inbox p {
  margin: 0;
  opacity: 0.9;
}
.inbox-cta {
  height: 40px;
  padding: 0 22px;
  border: 0;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}
.notice {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}
.notice.work {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.notice.curate-note {
  margin-top: 8px;
  margin-bottom: 2px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.inbox.curate {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.notice.done {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
tr.has-work td:first-child {
  box-shadow: inset 3px 0 0 var(--mt-highlight);
}
.progress-cell {
  min-width: 260px;
}
.progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.done-count {
  font-size: 12px;
  font-weight: 700;
}
.bar {
  margin-top: 8px;
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
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  height: 34px;
  padding: 0 14px;
  background: var(--mt-soft);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}
td {
  height: 64px;
  padding: 14px 14px;
  vertical-align: middle;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.avatars {
  display: flex;
}
.avatar {
  border: 2px solid var(--mt-surface, #fff);
  margin-left: -8px;
  font-size: 11px;
  font-weight: 700;
}
.avatar:first-child {
  margin-left: 0;
}
.num {
  text-align: right;
}
.name {
  font-weight: 800;
  font-size: 14px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.small-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.small-btn.accent {
  background: var(--mt-accent);
  border-color: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.small-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
.text-input {
  box-sizing: border-box;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
}
.text-input.area {
  height: 80px;
  padding: 8px 12px;
  resize: vertical;
}
.text-input.num-input {
  width: 80px;
}
.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  padding: 0 20px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
