<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../components/Select.vue";
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

type QueueTab = "active" | "assigned" | "archived";
// la vista la fija la ruta (ADR-059): bandeja personal, todas las colas o archivadas
const tab = computed<QueueTab>(() => (route.meta.view as QueueTab | undefined) ?? "active");
const VIEW_TITLES: Record<QueueTab, string> = { assigned: "My inbox", active: "All queues", archived: "Archived" };

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
const assignedQueues = computed(() => sortedQueues.value.filter((q) => q.isReviewer));
const visibleQueues = computed(() => (tab.value === "archived" ? archivedQueues.value : tab.value === "assigned" ? assignedQueues.value : sortedQueues.value));

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

async function setArchived(queue: AnnotationQueueSummaryDto, archived: boolean) {
  try {
    await api.updateAnnotationQueue(queue.id, { archived });
    await queues.run();
  } catch (error) {
    notifyError(`Could not ${archived ? "archive" : "restore"} the queue`, error);
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
const STATUS_OPTIONS: { label: string; value: "" | "ok" | "error" }[] = [
  { label: "Any", value: "" },
  { label: "OK", value: "ok" },
  { label: "Error", value: "error" },
];
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Review' }, { label: VIEW_TITLES[tab] }]" :icon="ICON" :title="VIEW_TITLES[tab]">
      <Button variant="primary" v-if="canManage" data-testid="new-queue" @click="openCreate" class="mt-new">+ New queue</Button>
    </PageHeader>

    <section v-if="pendingTotal > 0" class="inbox" data-testid="inbox">
      <div class="inbox-text">
        <span class="eyebrow">YOUR REVIEW INBOX</span>
        <h2>{{ pendingTotal }} {{ pendingTotal === 1 ? "conversation is" : "conversations are" }} waiting for you</h2>
        <p>Across {{ pendingQueues.length }} {{ pendingQueues.length === 1 ? "queue" : "queues" }} · nobody gets the same item twice, and you can skip anything you are unsure about</p>
      </div>
      <Button data-testid="continue-reviewing" @click="continueReviewing">Continue reviewing →</Button>
    </section>
    <section v-if="curateTotal > 0" class="inbox curate" data-testid="curate-inbox">
      <div class="inbox-text">
        <span class="eyebrow">READY FOR YOU</span>
        <h2>{{ curateTotal }} reviewed {{ curateTotal === 1 ? "item is" : "items are" }} waiting for your decision</h2>
        <p>Reviewers have finished {{ curateTotal === 1 ? "it" : "them" }} in {{ curateQueues.length }} {{ curateQueues.length === 1 ? "queue" : "queues" }}. Check their answers, settle any disagreement and add the good ones to a dataset.</p>
      </div>
      <Button data-testid="open-results" @click="openDetail(curateQueues[0]!.id, 'results')">Open results →</Button>
    </section>

    <p v-if="pendingTotal === 0 && curateTotal === 0 && queues.data.value?.items.length" class="hint muted">You are all caught up.</p>

    <ErrorBanner v-if="queues.error.value" :error="queues.error.value" @retry="queues.run()" />
    <LoadingState v-else-if="queues.loading.value && !queues.data.value" size="lg" />
    <EmptyState v-else-if="(queues.data.value?.items.length ?? 0) === 0" icon="rate_review" title="No review queues yet">
      {{ canManage ? 'Create one with "New queue" (you need at least one score config first).' : "Ask an experiment admin to create one." }}
    </EmptyState>
    <p v-else-if="visibleQueues.length === 0" class="hint muted" data-testid="queues-empty-tab">
      {{ tab === "archived" ? "No archived queues." : tab === "assigned" ? "You are not assigned to any queue." : "You are all caught up." }}
    </p>

    <Card padding="none" block v-if="visibleQueues.length" class="table-card">
      <div class="grid head">
        <span>Queue</span>
        <span>Rubric</span>
        <span>Progress</span>
        <span>Reviewers</span>
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
            <span class="done-count">{{ q.progress.completed }} of {{ total(q) }}</span>
            <span class="state" :class="{ done: q.progress.pending === 0 }" data-testid="queue-pending">{{ q.progress.pending > 0 ? `${q.progress.pending} pending` : "Done" }}</span>
          </div>
          <div class="bar" aria-hidden="true"><div class="bar-fill" :class="{ complete: q.progress.pending === 0 }" :style="{ width: `${percent(q)}%` }" /></div>
          <span v-if="canCurate && q.toCurate > 0" class="curate-note" data-testid="queue-to-curate">{{ q.toCurate }} to review &amp; add to a dataset</span>
        </div>
        <div class="avatars" data-testid="queue-reviewers">
          <span v-for="r in q.assignedReviewers" :key="r.userId" class="avatar" :title="r.name ?? 'Former member'" :aria-label="r.name ?? 'Former member'" data-testid="queue-reviewer">
            <img v-if="r.image" :src="r.image" :alt="r.name ?? 'Former member'" referrerpolicy="no-referrer" />
            <span v-else>{{ initials(r.name) }}</span>
          </span>
        </div>
        <div class="actions">
          <Button variant="primary" size="sm" v-if="q.isReviewer && q.progress.pending > 0 && !q.archivedAt" @click="review(q.id)">Review</Button>
          <Button size="sm" v-else-if="canCurate && !q.archivedAt" data-testid="queue-results-btn" @click="openDetail(q.id, 'results')">View results</Button>
          <Button size="sm" v-else @click="openDetail(q.id)">Details</Button>
          <Button variant="icon" size="sm" class="more" aria-label="More actions" data-testid="queue-more">
            ⋯
            <Menu auto-close anchor="bottom right" self="top right" :offset="[0, 6]" class="queue-menu">
              <div class="menu-list">
                <MenuItem v-if="!q.archivedAt" @click="addTo = q">Add traces</MenuItem>
                <MenuItem v-if="canCurate && q.toCurate > 0" @click="openDetail(q.id, 'results')">Review results</MenuItem>
                <MenuItem @click="openDetail(q.id)">Details</MenuItem>
                <MenuItem v-if="canManage && !q.archivedAt" @click="setArchived(q, true)">Archive</MenuItem>
                <MenuItem v-if="canManage && q.archivedAt" @click="setArchived(q, false)">Restore</MenuItem>
              </div>
            </Menu>
          </Button>
        </div>
      </div>
    </Card>
    <p class="footnote muted">A queue is a batch of conversations that people review with a rubric. Business reviewers rate quality; technical reviewers can promote the best examples into a dataset.</p>

    <QueueDetailModal v-if="detailQueueId" :queue-id="detailQueueId" :can-manage="canManage" :initial-tab="detailTab" @close="detailQueueId = null" @changed="queues.run()" />

    <Modal v-if="showCreate" title="New review queue" @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <TextInput v-model="form.name" placeholder="Queue name" maxlength="200" aria-label="Queue name" />
        <TextInput multiline v-model="form.instructions" placeholder="Instructions for reviewers (optional)" maxlength="5000" aria-label="Instructions" />
        <label class="inline">
          Reviews required per item
          <TextInput v-model="form.requiredAnnotations" type="number" min="1" max="10" aria-label="Reviews required per item" />
        </label>
        <fieldset class="rubric">
          <legend>Reviewers</legend>
          <p class="muted">Only the people you pick can annotate in this queue.</p>
          <p v-if="!members.length" class="muted">This experiment has no members yet. Invite them in Admin → your experiment.</p>
          <div v-for="m in members" :key="m.userId" class="rubric-row">
            <Checkbox v-model="form.reviewerIds" :value="m.userId"> {{ m.name ?? m.email }} <span class="muted">{{ m.email }}</span></Checkbox>
          </div>
        </fieldset>
        <fieldset class="rubric">
          <legend>Rubric</legend>
          <p v-if="!configs.length" class="muted">No score configs yet. Create them in Admin → your experiment → Score configs.</p>
          <div v-for="c in configs" :key="c.id" class="rubric-row">
            <Checkbox v-model="form.picked[c.id]!.on"> {{ c.name }}</Checkbox>
            <Checkbox v-if="form.picked[c.id]?.on" class="muted" v-model="form.picked[c.id]!.required"> required</Checkbox>
          </div>
        </fieldset>
        <Button variant="primary" type="submit" :disabled="creating || !form.name.trim() || !rubric.length || !form.reviewerIds.length || form.requiredAnnotations > form.reviewerIds.length">Create</Button>
      </form>
    </Modal>

    <Modal v-if="addTo" :title="`Add traces to “${addTo.name}”`" @close="addTo = null">
      <form class="modal-form" @submit.prevent="addByFilter">
        <p class="muted">Adds the traces that match <em>now</em>; the queue keeps their ids, it does not follow new traffic.</p>
        <label class="inline">Last <TextInput v-model="filter.hours" type="number" min="1" max="720" aria-label="Hours" /> hours</label>
        <label class="inline">
          Root status
          <Select v-model="filter.status" :options="STATUS_OPTIONS" aria-label="Root status" />
        </label>
        <Checkbox class="inline" v-model="filter.hasErrors"> Only traces with a failed span</Checkbox>
        <label class="inline">Slower than (ms) <TextInput v-model="filter.minDurationMs" type="number" min="0" aria-label="Minimum duration" /></label>
        <label class="inline">{{ filter.random ? "Sample of" : "At most" }} <TextInput v-model="filter.limit" type="number" min="1" max="500" aria-label="Limit" /> traces</label>
        <Checkbox class="inline" v-model="filter.random" aria-label="Random sample"> Pick them at random from all matches instead of the first ones</Checkbox>
        <Button variant="primary" type="submit" :disabled="adding">Add traces</Button>
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
