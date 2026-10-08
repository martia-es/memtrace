<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { PromptSummaryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime } from "@/domain/format";
import { ENV_ORDER, environmentCoverage, releaseStatus, releaseSummary, sortEnvironments, timelineCells, type ReleaseState } from "@/domain/prompt-release";
import EmptyState from "../components/EmptyState.vue";
import EnvFlag from "../components/EnvFlag.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import PageHeader from "../components/PageHeader.vue";
import TextInput from "../components/TextInput.vue";
import { useAsync } from "../composables/useAsync";
import { usePermissions } from "../composables/usePermissions";
import { usePromptApi } from "../composables/usePromptApi";

const api = usePromptApi();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const { can } = usePermissions();

const experimentId = computed(() => String(route.params.experimentId));
const showArchived = ref(false);
const prompts = useAsync((signal) => api.listForAgent(experimentId.value, showArchived.value, signal));
void prompts.run();

// ---- tablero: qué corre en cada entorno ----
const live = computed(() => (prompts.data.value ?? []).filter((p) => !p.archivedAt));
const coverage = computed(() => environmentCoverage(live.value));
const summary = computed(() => releaseSummary(live.value));
const ENV_NOTE: Record<string, (missing: number) => string> = {
  dev: () => "Where new versions are tried first",
  pre: (missing) => (missing === 0 ? "Every prompt is staged" : `${missing} ${missing === 1 ? "prompt never reached" : "prompts never reached"} PRE`),
  pro: (missing) => (missing === 0 ? "Every prompt is live" : `${missing} ${missing === 1 ? "prompt never reached" : "prompts never reached"} PRO`),
};
const envNote = (env: string, pinned: number, total: number) => (ENV_NOTE[env] ?? (() => ""))(total - pinned);

// ---- filtros ----
type StatusFilter = "all" | ReleaseState;
const status = ref<StatusFilter>("all");
const STATUS_CHIPS = computed<{ id: StatusFilter; label: string; count: number }[]>(() => [
  { id: "all", label: "All", count: live.value.length },
  { id: "behind", label: "Behind in PRO", count: summary.value.behind },
  { id: "in_sync", label: "In sync", count: summary.value.inSync },
  { id: "not_released", label: "Not released", count: summary.value.notReleased },
]);

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (prompts.data.value ?? []).filter((p) => {
    if (q && !p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
    return status.value === "all" || releaseStatus(p).state === status.value;
  });
});

interface Row {
  prompt: PromptSummaryDto;
  release: ReturnType<typeof releaseStatus>;
  tags: [string, number][];
  timeline: ReturnType<typeof timelineCells>;
}
const rows = computed<Row[]>(() =>
  filtered.value.map((prompt) => ({
    prompt,
    release: releaseStatus(prompt),
    tags: sortEnvironments(Object.keys(prompt.tags)).map((t): [string, number] => [t, prompt.tags[t]!]),
    timeline: timelineCells(prompt),
  })),
);

const RELEASE_LABEL = (r: ReturnType<typeof releaseStatus>) =>
  r.state === "behind" ? `${r.behindBy} ${r.behindBy === 1 ? "version" : "versions"} behind in PRO` : r.state === "in_sync" ? "In sync" : "Not released";

function open(promptId: string) {
  router.push({ name: "prompt", params: { experimentId: experimentId.value, promptId } });
}

// ---- create ----
const showCreate = ref(false);
const form = ref({ name: "", description: "", content: "", message: "" });
const creating = ref(false);
const fieldErrors = ref<Record<string, string>>({});
async function create() {
  creating.value = true;
  fieldErrors.value = {};
  try {
    const detail = await api.create(experimentId.value, { ...form.value, name: form.value.name.trim() });
    showCreate.value = false;
    form.value = { name: "", description: "", content: "", message: "" };
    open(detail.prompt.id);
  } catch (error) {
    const err = error as Error & { fields?: Record<string, string> };
    fieldErrors.value = err.fields ?? {};
    $q.notify({ message: `Could not create the prompt: ${describeApiError(err)}`, color: "negative", timeout: 4000 });
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Prompts' }, { label: 'Prompts' }]" icon="M4 6h16M4 12h16M4 18h10" title="Prompts">
      <div class="actions">
        <TextInput v-model="search" type="search" placeholder="Filter by name…" class="search" />
        <label class="archived-toggle"><input v-model="showArchived" type="checkbox" data-testid="show-archived" @change="prompts.run()" /> Show archived</label>
        <button v-if="can('prompt:write')" type="button" class="primary-btn" data-testid="new-prompt" @click="showCreate = true">+ New prompt</button>
      </div>
    </PageHeader>

    <ErrorBanner v-if="prompts.error.value" :error="prompts.error.value" @retry="prompts.run()" />
    <div v-else-if="prompts.loading.value && !prompts.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="(prompts.data.value?.length ?? 0) === 0" icon="edit_note" title="No prompts yet">Create one with "New prompt" to start versioning what your agent says.</EmptyState>

    <template v-else>
      <section class="board" data-testid="release-board" aria-label="What is live">
        <div class="board-intro">
          <span class="eyebrow">WHAT IS LIVE</span>
          <strong>{{ live.length }} {{ live.length === 1 ? "prompt" : "prompts" }}, {{ ENV_ORDER.length }} environments</strong>
        </div>
        <div v-for="c in coverage" :key="c.env" class="board-env" :data-testid="`coverage-${c.env}`">
          <div class="board-env-head">
            <span class="env-name" :class="c.env">{{ c.env.toUpperCase() }}</span>
            <strong class="big" :data-testid="`coverage-count-${c.env}`">{{ c.pinned }}</strong>
            <span class="soft">of {{ c.total }} pinned</span>
          </div>
          <div class="meter" aria-hidden="true"><span v-for="i in c.total" :key="i" :class="{ on: i <= c.pinned }" /></div>
          <span class="soft">{{ envNote(c.env, c.pinned, c.total) }}</span>
        </div>
        <div class="board-drift" :class="{ calm: summary.behind === 0 }" data-testid="drift">
          <template v-if="summary.behind > 0">
            <strong class="big">{{ summary.behind }} {{ summary.behind === 1 ? "prompt" : "prompts" }}</strong>
            <span class="drift-title">{{ summary.behind === 1 ? "runs" : "run" }} behind latest in PRO</span>
            <span class="drift-sub">{{ summary.waitingVersions }} {{ summary.waitingVersions === 1 ? "version" : "versions" }} waiting to be released</span>
          </template>
          <template v-else>
            <strong class="big">All released</strong>
            <span class="drift-sub">PRO runs the latest version of every prompt that has it</span>
          </template>
        </div>
      </section>

      <div class="toolbar">
        <button
          v-for="chip in STATUS_CHIPS"
          :key="chip.id"
          type="button"
          class="chip"
          :class="{ active: status === chip.id }"
          :data-testid="`status-${chip.id}`"
          :aria-pressed="status === chip.id"
          @click="status = chip.id"
        >
          {{ chip.label }} <b>{{ chip.count }}</b>
        </button>
        <span class="grow" />
        <span class="legend"><i class="bar released" /> released</span>
        <span class="legend"><i class="bar ahead" /> ahead of PRO</span>
      </div>

      <EmptyState v-if="rows.length === 0" icon="search_off" title="No matches">Try a different search or filter.</EmptyState>

      <div v-else class="rows">
        <article
          v-for="r in rows"
          :key="r.prompt.id"
          class="row"
          :data-testid="`prompt-row-${r.prompt.name}`"
          tabindex="0"
          @click="open(r.prompt.id)"
          @keydown.enter="open(r.prompt.id)"
        >
          <div class="who">
            <div class="who-name">
              <span class="name">{{ r.prompt.name }}</span>
              <span v-if="r.prompt.archivedAt" class="mt-pill archived">archived</span>
            </div>
            <div v-if="r.prompt.description" class="desc">{{ r.prompt.description }}</div>
            <div class="who-foot">
              <span class="state" :class="r.release.state" :data-testid="`release-${r.prompt.name}`"><i />{{ RELEASE_LABEL(r.release) }}</span>
              <span class="when mono">{{ formatDateTime(r.prompt.updatedAt) }}</span>
            </div>
          </div>

          <div class="tags-col">
            <span class="latest mono">v{{ r.prompt.latestVersion }}</span>
            <span v-for="[tag, version] in r.tags" :key="tag" class="mt-pill tag" :class="tag" :data-testid="`tag-${r.prompt.name}-${tag}`">{{ tag }} → v{{ version }}</span>
            <span v-if="r.tags.length === 0" class="soft">no tags</span>
          </div>

          <div class="track" :aria-label="`Last ${r.timeline.cells.length} versions`">
            <span v-if="r.timeline.older > 0" class="older mono">+{{ r.timeline.older }}</span>
            <div v-for="(cell, i) in r.timeline.cells" :key="cell.version" class="cell">
              <div class="flags"><EnvFlag v-for="t in cell.tags" :key="t" :env="t" /></div>
              <div class="line">
                <span class="seg" :class="{ hidden: i === 0 && r.timeline.older === 0, ahead: cell.ahead }" />
                <span class="dot" :class="{ tagged: cell.tags.length > 0, latest: cell.latest, ahead: cell.ahead }" />
                <span class="seg" :class="{ hidden: i === r.timeline.cells.length - 1, ahead: i < r.timeline.cells.length - 1 && r.timeline.cells[i + 1]!.ahead }" />
              </div>
              <span class="num mono" :class="{ strong: cell.tags.length > 0 || cell.latest }">v{{ cell.version }}</span>
            </div>
          </div>
        </article>
      </div>
    </template>

    <Modal v-if="showCreate" title="New prompt" medium @close="showCreate = false">
      <form class="modal-form" @submit.prevent="create">
        <TextInput v-model="form.name" placeholder="name, e.g. weather-system" mono autofocus :invalid="!!fieldErrors.name" data-testid="prompt-name" />
        <p v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</p>
        <TextInput v-model="form.description" placeholder="What is it for? (optional)" />
        <TextInput v-model="form.content" multiline :rows="10" mono placeholder="Prompt text. Use {{variable}} for the parts that change." :invalid="!!fieldErrors.content" data-testid="prompt-content" />
        <p v-if="fieldErrors.content" class="field-error">{{ fieldErrors.content }}</p>
        <TextInput v-model="form.message" placeholder="Message for version 1 (optional)" />
        <button type="submit" class="primary-btn" :disabled="creating || !form.name.trim() || !form.content.trim()" data-testid="create-prompt">Create</button>
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
  gap: 14px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
  overflow: auto;
}
.actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.search {
  width: 240px;
}
.archived-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--mt-muted);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.soft {
  color: var(--mt-muted);
  font-size: 12px;
}

/* ---- tablero ---- */
.board {
  flex: none;
  display: flex;
  align-items: stretch;
  min-height: 108px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--mt-ink);
  color: #fff;
}
.board > * {
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}
.board-intro {
  flex: none;
  width: 220px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}
.board-intro strong {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.2;
}
.eyebrow {
  font-family: var(--mt-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--mt-brand);
}
.board-env {
  flex: 1;
  min-width: 0;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}
.board-env .soft,
.board-drift .drift-sub {
  color: rgba(255, 255, 255, 0.62);
}
.board-env-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.env-name {
  font-family: var(--mt-mono);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.7);
}
.env-name.pre {
  color: #f6c453;
}
.env-name.pro {
  color: var(--mt-brand);
}
.big {
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.meter {
  display: flex;
  gap: 4px;
}
.meter span {
  flex: 1;
  max-width: 48px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.16);
}
.meter span.on {
  background: rgba(255, 255, 255, 0.85);
}
.board-env:nth-of-type(3) .meter span.on {
  background: #f6c453;
}
.board-env:nth-of-type(4) .meter span.on {
  background: var(--mt-brand);
}
.board-drift {
  flex: none;
  width: 250px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  background: var(--mt-highlight);
  color: var(--mt-ink);
  border-right: none;
}
.board-drift .big {
  font-size: 28px;
  line-height: 1.05;
}
.board-drift .drift-title {
  font-size: 13px;
  font-weight: 700;
}
.board-drift .drift-sub {
  color: var(--mt-ink);
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
}
.board-drift.calm {
  background: var(--mt-brand);
}

/* ---- filtros ---- */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.grow {
  flex: 1;
}
.chip {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--mt-line);
  border-radius: 14px;
  background: var(--mt-card);
  color: var(--mt-muted);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.chip b {
  margin-left: 6px;
  color: var(--mt-ink);
}
.chip.active {
  background: var(--mt-ink);
  border-color: var(--mt-ink);
  color: #fff;
}
.chip.active b {
  color: #fff;
}
.legend {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mt-muted);
}
.bar {
  display: inline-block;
  width: 18px;
  height: 3px;
  border-radius: 2px;
}
.bar.released {
  background: var(--mt-brand);
}
.bar.ahead {
  background: var(--mt-highlight);
}

/* ---- filas ---- */
.rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  flex: none;
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(160px, 220px) minmax(0, 1fr);
  align-items: stretch;
  gap: 18px;
  padding: 14px 18px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  border-color: var(--mt-accent);
  outline: none;
}
.who {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.who-name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.name {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--mt-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.who-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.when {
  font-size: 11px;
  color: var(--mt-faint);
}
.state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--mt-radius-xs);
  font-size: 11.5px;
  font-weight: 800;
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.state i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mt-faint);
}
.state.in_sync {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.state.in_sync i {
  background: var(--mt-ok);
}
.state.behind {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.state.behind i {
  background: var(--mt-highlight);
}
.tags-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 5px;
}
.latest {
  font-size: 12px;
  font-weight: 800;
  color: var(--mt-ink);
}
.tag {
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-family: var(--mt-mono);
  font-weight: 500;
  font-size: 11.5px;
}
.tag.pre {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.tag.pro {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.archived {
  background: var(--mt-soft);
  color: var(--mt-muted);
}

/* ---- línea de versiones ---- */
.track {
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  overflow: hidden;
}
.older {
  align-self: flex-end;
  margin: 0 6px 0 0;
  font-size: 11px;
  color: var(--mt-faint);
}
.cell {
  flex: none;
  width: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.flags {
  min-height: 42px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 3px;
}
.line {
  width: 100%;
  height: 20px;
  display: flex;
  align-items: center;
}
.seg {
  flex: 1;
  height: 3px;
  background: var(--mt-brand);
}
.seg.ahead {
  background: var(--mt-highlight);
}
.seg.hidden {
  background: transparent;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid var(--mt-brand);
  background: var(--mt-card);
}
.dot.ahead {
  border-color: var(--mt-highlight);
}
.dot.tagged {
  width: 14px;
  height: 14px;
}
.dot.latest {
  width: 16px;
  height: 16px;
  border-color: var(--mt-ink);
  background: var(--mt-ink);
}
.num {
  font-size: 11px;
  color: var(--mt-faint);
}
.num.strong {
  font-weight: 800;
  color: var(--mt-ink);
}
@media (max-width: 1100px) {
  .row {
    grid-template-columns: 1fr;
  }
  .track {
    justify-content: flex-start;
    overflow-x: auto;
  }
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field-error {
  margin: -6px 0 0;
  font-size: 12px;
  color: var(--mt-err-ink);
}
.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
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
  transition: opacity 0.15s ease;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-btn:not(:disabled):hover {
  opacity: 0.9;
}
</style>
