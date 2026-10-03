<script setup lang="ts">
import { computed, inject, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { AnnotationQueueSummaryDto, ScoreConfigDto } from "@contract";
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
const canManage = computed(() => currentExperiment.value?.myRole === "admin" || currentExperiment.value?.myRole === "org_admin");

const queues = useAsync((signal) => api.listAnnotationQueues(false, signal));
void queues.run();

function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${error instanceof Error ? error.message : String(error)}`, color: "negative", timeout: 4000 });
}

const total = (q: AnnotationQueueSummaryDto) => q.progress.pending + q.progress.completed + q.progress.skipped;

// Colas con trabajo pendiente primero, para que el reviewer vea de un vistazo dónde tiene que ir.
const sortedQueues = computed(() =>
  [...(queues.data.value?.items ?? [])].sort((a, b) => Number(b.progress.pending > 0) - Number(a.progress.pending > 0)),
);

const review = (queueId: string) => void router.push({ name: "annotation-queue-review", params: { experimentId: experimentId.value, queueId } });

// ---- details ----
const detailQueueId = ref<string | null>(null);

// ---- create ----
const showCreate = ref(false);
const configs = ref<ScoreConfigDto[]>([]);
const form = reactive({ name: "", instructions: "", requiredAnnotations: 1, picked: {} as Record<string, { on: boolean; required: boolean }> });
const creating = ref(false);
const rubric = computed(() => Object.entries(form.picked).filter(([, v]) => v.on).map(([configId, v]) => ({ configId, required: v.required })));

async function openCreate() {
  showCreate.value = true;
  try {
    configs.value = await identityApi.listScoreConfigs(experimentId.value);
    for (const c of configs.value) form.picked[c.id] ??= { on: false, required: true };
  } catch (error) {
    notifyError("Could not load score configs", error);
  }
}

async function create() {
  creating.value = true;
  try {
    await api.createAnnotationQueue({
      name: form.name.trim(),
      instructions: form.instructions.trim() || null,
      requiredAnnotations: form.requiredAnnotations,
      rubric: rubric.value,
    });
    showCreate.value = false;
    Object.assign(form, { name: "", instructions: "", requiredAnnotations: 1, picked: {} });
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
    <PageHeader :crumbs="[{ label: 'Review' }]" :icon="ICON" title="Review queues">
      <button v-if="canManage" type="button" class="primary-btn" data-testid="new-queue" @click="openCreate">New queue</button>
    </PageHeader>

    <p class="hint muted">
      A queue is a batch of traces for people to review with a rubric (score configs). Reviewers pull the next trace, label it and move on; nobody gets the same
      trace twice. Add traces here by filter, or from any trace's detail.
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
            <th>Pending</th>
            <th class="num">Reviews / item</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="q in sortedQueues"
            :key="q.id"
            data-testid="queue-row"
            :class="{ 'has-work': q.progress.pending > 0 }"
          >
            <td class="name">{{ q.name }}</td>
            <td>
              <span v-if="q.progress.pending > 0" class="notice work" data-testid="queue-pending">
                <span class="notice-dot" aria-hidden="true" />
                {{ q.progress.pending }} de {{ total(q) }} por revisar
              </span>
              <span v-else class="notice done" data-testid="queue-pending">
                <span class="notice-dot" aria-hidden="true" />
                Al día · {{ total(q) }} revisadas
              </span>
            </td>
            <td class="num mono">{{ q.requiredAnnotations }}</td>
            <td class="actions">
              <button type="button" class="small-btn" :class="{ accent: q.progress.pending > 0 }" :disabled="q.progress.pending === 0" @click="review(q.id)">Review</button>
              <button type="button" class="small-btn" @click="addTo = q">Add traces</button>
              <button type="button" class="small-btn" @click="detailQueueId = q.id">Details</button>
              <button v-if="canManage" type="button" class="small-btn" @click="archive(q)">Archive</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <QueueDetailModal v-if="detailQueueId" :queue-id="detailQueueId" :can-manage="canManage" @close="detailQueueId = null" @changed="queues.run()" />

    <Modal v-if="showCreate" title="New review queue" @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <input v-model="form.name" class="text-input" placeholder="Queue name" maxlength="200" aria-label="Queue name" />
        <textarea v-model="form.instructions" class="text-input area" placeholder="Instructions for reviewers (optional)" maxlength="5000" aria-label="Instructions" />
        <label class="inline">
          Reviews required per item
          <input v-model.number="form.requiredAnnotations" class="text-input num-input" type="number" min="1" max="10" aria-label="Reviews required per item" />
        </label>
        <fieldset class="rubric">
          <legend>Rubric</legend>
          <p v-if="!configs.length" class="muted">No score configs yet. Create them in Admin → your experiment → Score configs.</p>
          <div v-for="c in configs" :key="c.id" class="rubric-row">
            <label><input v-model="form.picked[c.id]!.on" type="checkbox" /> {{ c.name }}</label>
            <label v-if="form.picked[c.id]?.on" class="muted"><input v-model="form.picked[c.id]!.required" type="checkbox" /> required</label>
          </div>
        </fieldset>
        <button type="submit" class="primary-btn" :disabled="creating || !form.name.trim() || !rubric.length">Create</button>
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
  padding: 16px;
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
.notice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.notice-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.notice.work {
  background: #fef3c7;
  color: #92400e;
}
.notice.done {
  background: #dcfce7;
  color: #166534;
}
tr.has-work td:first-child {
  box-shadow: inset 2px 0 0 #f59e0b;
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
  padding: 8px 12px;
  background: var(--mt-card, #fff);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.num {
  text-align: right;
}
.name {
  font-weight: 600;
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
