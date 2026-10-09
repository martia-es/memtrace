<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { PromptSummaryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime } from "@/domain/format";
import { extractVariables, includeSyntax } from "@/domain/prompt-fragment";
import { ENV_ORDER, environmentCoverage, releaseStatus, releaseSummary, sortEnvironments, timelineCells, type ReleaseState } from "@/domain/prompt-release";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import ApprovalInbox from "../components/ApprovalInbox.vue";
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
const current = inject(CURRENT_EXPERIMENT, computed(() => null));
const organizationId = computed(() => current.value?.organizationId ?? null);
const showArchived = ref(false);
const prompts = useAsync((signal) => api.listForAgent(experimentId.value, showArchived.value, signal));
void prompts.run().then(() => {
  // un enlace desde una traza, conversación o evaluación (`?open=nombre&version=N`) abre esa versión del prompt (ADR-068)
  const name = typeof route.query.open === "string" ? route.query.open : null;
  if (!name) return;
  const found = (prompts.data.value ?? []).find((p) => p.name === name);
  if (!found) {
    $q.notify({ message: `The prompt "${name}" is not registered for this agent in MemTrace.`, color: "warning", timeout: 5000 });
    return;
  }
  const version = typeof route.query.version === "string" ? route.query.version : undefined;
  void router.replace({ name: "prompt", params: { experimentId: experimentId.value, promptId: found.id }, query: { tab: "traces", ...(version ? { version } : {}) } });
});

// ---- tablero: qué corre en cada entorno ----
const live = computed(() => (prompts.data.value ?? []).filter((p) => !p.archivedAt && p.kind !== "fragment"));
// los fragmentos (ADR-073) no se despliegan por entorno: no entran en el tablero ni en los estados de release
const fragments = computed(() => (prompts.data.value ?? []).filter((p) => p.kind === "fragment"));
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
    if (p.kind === "fragment") return false;
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
/** Ejemplos para los textos de ayuda (`}}` dentro de una plantilla de Vue la rompe). */
const example = (ref: string) => includeSyntax("name", ref);
const asVariable = (name: string) => `{{${name}}}`;
const sampleInclude = includeSyntax("tone", "pro");
const sampleVariable = asVariable("language");
/** variables que el texto escrito aporta: las heredan los prompts que lo incluyan */
/** cómo se incluiría el fragmento que se está escribiendo */
const ownInclude = computed(() => includeSyntax(form.value.name.trim() || "name", "pro"));
const formVariables = computed(() => extractVariables(form.value.content));
const showCreate = ref(false);
function openCreate(kind: "prompt" | "fragment") {
  form.value.kind = kind;
  showCreate.value = true;
}
const form = ref({ kind: "prompt" as "prompt" | "fragment", name: "", description: "", content: "", message: "" });
const creating = ref(false);
const fieldErrors = ref<Record<string, string>>({});
async function create() {
  creating.value = true;
  fieldErrors.value = {};
  try {
    const detail = await api.create(experimentId.value, { ...form.value, name: form.value.name.trim() });
    showCreate.value = false;
    form.value = { kind: "prompt", name: "", description: "", content: "", message: "" };
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
        <button v-if="can('prompt:write')" type="button" class="primary-btn" data-testid="new-prompt" @click="openCreate('prompt')">+ New prompt</button>
      </div>
    </PageHeader>

    <ApprovalInbox v-if="organizationId" :organization-id="organizationId" />

    <ErrorBanner v-if="prompts.error.value" :error="prompts.error.value" @retry="prompts.run()" />
    <div v-else-if="prompts.loading.value && !prompts.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <section v-else-if="(prompts.data.value?.length ?? 0) === 0" class="welcome" data-testid="empty-state">
      <div class="welcome-head">
        <h2>Version what your agent says</h2>
        <p>Every save is a version, tags decide which one runs in DEV, PRE and PRO, and each version keeps its own traces, cost and errors.</p>
      </div>
      <div class="welcome-cards">
        <article class="welcome-card">
          <span class="eyebrow">PROMPT</span>
          <h3>New prompt</h3>
          <p>The text your agent runs with. Use <code>{{ sampleVariable }}</code> for the parts that change.</p>
          <pre class="sample">You are a weather assistant. Answer in {{ sampleVariable }}.</pre>
          <button v-if="can('prompt:write')" type="button" class="primary-btn" data-testid="empty-new-prompt" @click="openCreate('prompt')">+ New prompt</button>
        </article>
        <article class="welcome-card">
          <span class="eyebrow">FRAGMENT</span>
          <h3>New fragment</h3>
          <p>Text shared by several prompts (tone, policies, format). Edit it once and the prompts that use it get a new draft.</p>
          <pre class="sample">In your prompt: {{ sampleInclude }}</pre>
          <button v-if="can('prompt:write')" type="button" class="outline-btn" data-testid="empty-new-fragment" @click="openCreate('fragment')">+ New fragment</button>
        </article>
      </div>
      <button v-if="!showArchived" type="button" class="link-btn" data-testid="show-archived-empty" @click="showArchived = true; prompts.run()">Show archived prompts</button>
    </section>

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
        <span class="toolbar-sep" aria-hidden="true" />
        <label class="archived-switch" :class="{ on: showArchived }">
          <input v-model="showArchived" type="checkbox" class="sr-only" data-testid="show-archived" @change="prompts.run()" />
          <span class="switch" aria-hidden="true"><i /></span>
          Show archived
        </label>
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

    <section v-if="prompts.data.value && prompts.data.value.length > 0" class="fragments" data-testid="fragments">
      <div class="fragments-head">
        <div class="fragments-intro">
          <span class="eyebrow">FRAGMENTS · {{ fragments.length }}</span>
          <p class="soft small">Shared text that prompts include with <code>{{ sampleInclude }}</code>. Changing one proposes a new version of every prompt that uses it.</p>
        </div>
        <button v-if="can('prompt:write')" type="button" class="outline-btn" data-testid="new-fragment" @click="openCreate('fragment')">+ New fragment</button>
      </div>
      <p v-if="fragments.length === 0" class="soft small fragments-empty" data-testid="fragments-empty">No fragments yet.</p>
      <article
        v-for="f in fragments"
        :key="f.id"
        class="fragment-row"
        :data-testid="`fragment-row-${f.name}`"
        tabindex="0"
        @click="open(f.id)"
        @keydown.enter="open(f.id)"
      >
        <span class="name">{{ f.name }}</span>
        <span v-if="f.archivedAt" class="mt-pill archived">archived</span>
        <span v-if="f.description" class="soft frag-desc">{{ f.description }}</span>
        <span class="grow" />
        <span class="mono">v{{ f.latestVersion }}</span>
        <span v-for="[tag, version] in sortEnvironments(Object.keys(f.tags)).map((t): [string, number] => [t, f.tags[t]!])" :key="tag" class="mt-pill tag" :class="tag">{{ tag }} → v{{ version }}</span>
      </article>
    </section>

    <Modal v-if="showCreate" :title="form.kind === 'fragment' ? 'New fragment' : 'New prompt'" :medium="form.kind !== 'fragment'" :wide="form.kind === 'fragment'" @close="showCreate = false">
      <form class="modal-form" :class="{ split: form.kind === 'fragment' }" @submit.prevent="create">
        <p v-if="form.kind === 'fragment'" class="hint small intro" data-testid="fragment-hint">
          A fragment is text shared by several prompts (tone, policies, format). A prompt includes it with <code>{{ example("pro") }}</code>
          (by tag) or <code>{{ example("3") }}</code> (by version), and the version it points to when saving is pinned.
        </p>
        <div class="fields">
          <TextInput v-model="form.name" placeholder="name, e.g. weather-system" mono autofocus :invalid="!!fieldErrors.name" data-testid="prompt-name" />
          <p v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</p>
          <TextInput v-model="form.description" placeholder="What is it for? (optional)" />
          <TextInput v-model="form.content" multiline :rows="10" mono placeholder="Prompt text. Use {{variable}} for the parts that change." :invalid="!!fieldErrors.content" data-testid="prompt-content" />
          <p v-if="fieldErrors.content" class="field-error">{{ fieldErrors.content }}</p>
          <TextInput v-model="form.message" placeholder="Message for version 1 (optional)" />
        </div>
        <aside v-if="form.kind === 'fragment'" class="aside-cards">
          <div class="aside-card" data-testid="fragment-variables">
            <span class="eyebrow">VARIABLES IT BRINGS</span>
            <p class="soft small">Every prompt that includes it gets these variables too.</p>
            <div class="vars">
              <code v-for="v in formVariables" :key="v" class="var">{{ asVariable(v) }}</code>
              <span v-if="formVariables.length === 0" class="soft small">none yet</span>
            </div>
          </div>
          <div class="aside-card accent">
            <span class="eyebrow">HOW A PROMPT USES IT</span>
            <p class="soft small">Pick it from <b>Insert fragment</b> in the prompt editor, or type:</p>
            <code class="snippet">{{ ownInclude }}</code>
            <p class="soft small">The tag or version is required: a prompt always knows exactly which text it got.</p>
          </div>
        </aside>
        <div class="modal-foot">
          <span v-if="form.kind === 'fragment'" class="soft small">Creates v1, published. Nothing runs in an agent until a prompt includes it.</span>
          <span class="grow" />
          <button type="button" class="ghost-btn" @click="showCreate = false">Cancel</button>
          <button type="submit" class="primary-btn" :disabled="creating || !form.name.trim() || !form.content.trim()" data-testid="create-prompt">{{ form.kind === "fragment" ? "Create fragment" : "Create" }}</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.fragments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.fragments-head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fragments-intro {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fragments-intro p,
.fragments-empty {
  margin: 0;
}
.frag-desc {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
code {
  font-family: var(--mt-mono);
}
.fragment-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
  cursor: pointer;
}
.fragment-row:hover,
.fragment-row:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.hint {
  margin: 0;
  color: var(--mt-muted);
}
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
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.soft {
  color: var(--mt-muted);
  font-size: 12px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--mt-line);
}
.archived-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--mt-line);
  border-radius: 14px;
  background: var(--mt-card);
  color: var(--mt-muted);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.archived-switch:focus-within {
  outline: 2px solid var(--mt-accent);
  outline-offset: 2px;
}
.switch {
  position: relative;
  width: 26px;
  height: 14px;
  border-radius: 7px;
  background: var(--mt-line);
}
.switch i {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--mt-card);
  transition: transform 0.15s ease;
}
.archived-switch.on .switch {
  background: var(--mt-accent);
}
.archived-switch.on .switch i {
  transform: translateX(12px);
}

/* ---- estado vacío ---- */
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  padding: 40px 0;
}
.welcome-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}
.welcome-head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.welcome-head p {
  margin: 0;
  max-width: 520px;
  color: var(--mt-muted);
  line-height: 1.5;
}
.welcome-cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 20px;
}
.welcome-card {
  width: 380px;
  max-width: 100%;
  box-sizing: border-box;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: 10px;
}
.welcome-card h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.welcome-card p {
  margin: 0;
  line-height: 1.5;
  color: var(--mt-muted);
}
.sample {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-family: var(--mt-mono);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.welcome-card .primary-btn,
.welcome-card .outline-btn {
  margin-top: 4px;
  height: 36px;
}
.outline-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--mt-accent);
  border-radius: 6px;
  background: var(--mt-card);
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}
.outline-btn:hover {
  background: var(--mt-accent-tint);
}
.link-btn {
  border: none;
  background: none;
  color: var(--mt-accent-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
}

/* ---- tablero ---- */
.board {
  flex: none;
  display: flex;
  align-items: stretch;
  min-height: 108px;
  border-radius: 10px;
  overflow: hidden;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  color: var(--mt-ink);
}
.board > * {
  border-right: 1px solid var(--mt-line);
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
  color: var(--mt-accent);
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
  color: var(--mt-muted);
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
  color: var(--mt-muted);
}
.env-name.pre {
  color: var(--mt-warn-ink);
}
.env-name.pro {
  color: var(--mt-accent-text);
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
  background: var(--mt-line);
}
.meter span.on {
  background: var(--mt-faint);
}
.board-env:nth-of-type(3) .meter span.on {
  background: var(--mt-warn);
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
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
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
  color: var(--mt-highlight-ink);
  font-size: 12px;
  font-weight: 600;
  opacity: 0.8;
}
.board-drift.calm {
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.board-drift.calm .drift-sub {
  color: var(--mt-accent-text);
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
  background: var(--mt-accent-tint);
  border-color: var(--mt-accent-soft);
  color: var(--mt-accent-text);
  font-weight: 800;
}
.chip.active b {
  color: var(--mt-accent-text);
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
  border-color: var(--mt-accent);
  background: var(--mt-accent);
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
.modal-form.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 14px 20px;
}
.modal-form .intro,
.modal-form .modal-foot {
  grid-column: 1 / -1;
}
.fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.aside-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.aside-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border-radius: 8px;
  background: var(--mt-soft);
}
.aside-card.accent {
  background: var(--mt-accent-tint);
  border: 1px solid var(--mt-accent-soft);
}
.aside-card p {
  margin: 0;
  line-height: 1.5;
}
.vars {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.var {
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-size: 11.5px;
}
.snippet {
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--mt-card);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.modal-foot {
  display: flex;
  align-items: center;
  gap: 10px;
}
.modal-foot .primary-btn {
  height: 36px;
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
