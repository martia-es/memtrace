<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuasar } from "quasar";
import type { PromptSummaryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime } from "@/domain/format";
import { extractVariables, includeSyntax } from "@/domain/prompt-fragment";
import { ENV_ORDER, releaseStatus, releaseSummary, sortEnvironments, type ReleaseState } from "@/domain/prompt-release";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import ApprovalInbox from "../components/ApprovalInbox.vue";
import DataTable from "../components/DataTable.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import Modal from "../components/Modal.vue";
import PromptEditor from "../components/PromptEditor.vue";
import PageHeader from "../components/PageHeader.vue";
import TextInput from "../components/TextInput.vue";
import { useApprovalInbox } from "../composables/useApprovalInbox";
import { useAsync } from "../composables/useAsync";
import { usePermissions } from "../composables/usePermissions";
import { usePromptApi } from "../composables/usePromptApi";
import Button from "../components/Button.vue";
import Menu from "../components/Menu.vue";
import MenuItem from "../components/MenuItem.vue";
import Pill from "../components/Pill.vue";
import LoadingState from "../components/LoadingState.vue";
import Select from "../components/Select.vue";
import SegmentedControl from "../components/SegmentedControl.vue";

const api = usePromptApi();
const route = useRoute();
const router = useRouter();
const $q = useQuasar();
const { can } = usePermissions();

const experimentId = computed(() => String(route.params.experimentId));
const current = inject(CURRENT_EXPERIMENT, computed(() => null));
const awaitingMe = useApprovalInbox().promptIds;
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

// ---- qué corre en cada entorno ----
const live = computed(() => (prompts.data.value ?? []).filter((p) => !p.archivedAt && p.kind !== "fragment"));
// los fragmentos (ADR-073) no se despliegan por entorno: no entran en el aviso ni en los estados de release
const fragments = computed(() => (prompts.data.value ?? []).filter((p) => p.kind === "fragment"));
const summary = computed(() => releaseSummary(live.value));

// ---- filtros: viajan en la URL (`?kind=fragments`, `?status=behind`); el valor por defecto no se escribe ----
type Kind = "prompts" | "fragments";
type StatusFilter = "all" | ReleaseState;
const STATUS_VALUES: StatusFilter[] = ["all", "behind", "in_sync", "not_released"];
const kind = computed<Kind>({
  get: () => (route.query.kind === "fragments" ? "fragments" : "prompts"),
  set: (v) => void router.replace({ query: { ...route.query, kind: v === "fragments" ? "fragments" : undefined } }),
});
const status = computed<StatusFilter>({
  get: () => STATUS_VALUES.find((v) => v === route.query.status) ?? "all",
  set: (v) => void router.replace({ query: { ...route.query, status: v === "all" ? undefined : v } }),
});
const KIND_OPTIONS = computed(() => [
  { value: "prompts", label: "Prompts", count: live.value.length, testid: "kind-prompts" },
  { value: "fragments", label: "Fragments", count: fragments.value.length, testid: "kind-fragments" },
]);
const STATUS_OPTIONS = computed(() => [
  { value: "all", label: "All" },
  { value: "behind", label: `Behind in PRO · ${summary.value.behind}` },
  { value: "in_sync", label: `In sync · ${summary.value.inSync}` },
  { value: "not_released", label: `Not released · ${summary.value.notReleased}` },
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
const shownFragments = computed(() => {
  const q = search.value.trim().toLowerCase();
  return fragments.value.filter((f) => !q || f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q));
});

/** Una celda por entorno: la versión que apunta el tag y, en producción, cuánto va por detrás de la última. */
interface EnvCell {
  env: string;
  version: number | null;
  behind: number;
}
interface Row {
  prompt: PromptSummaryDto;
  release: ReturnType<typeof releaseStatus>;
  cells: EnvCell[];
}
const rows = computed<Row[]>(() =>
  filtered.value.map((prompt) => {
    const release = releaseStatus(prompt);
    return {
      prompt,
      release,
      cells: ENV_ORDER.map((env) => ({ env, version: prompt.tags[env] ?? null, behind: env === "pro" ? release.behindBy : 0 })),
    };
  }),
);
/** Etiquetas que no son de entorno (`stable`, `canary`…): no caben en una columna, se listan junto al nombre. */
const freeTags = (p: PromptSummaryDto) => sortEnvironments(Object.keys(p.tags).filter((t) => !(ENV_ORDER as readonly string[]).includes(t)));

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
const contentPlaceholder = "Prompt text. Use {{variable}} for the parts that change.";
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
        <Button variant="primary" v-if="can('prompt:write')" data-testid="new-prompt" @click="openCreate('prompt')">+ New prompt</Button>
      </div>
    </PageHeader>

    <ApprovalInbox />

    <ErrorBanner v-if="prompts.error.value" :error="prompts.error.value" @retry="prompts.run()" />
    <LoadingState v-else-if="prompts.loading.value && !prompts.data.value" size="lg" />
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
          <Button variant="primary" v-if="can('prompt:write')" data-testid="empty-new-prompt" @click="openCreate('prompt')">+ New prompt</Button>
        </article>
        <article class="welcome-card">
          <span class="eyebrow">FRAGMENT</span>
          <h3>New fragment</h3>
          <p>Text shared by several prompts (tone, policies, format). Edit it once and the prompts that use it get a new draft.</p>
          <pre class="sample">In your prompt: {{ sampleInclude }}</pre>
          <Button v-if="can('prompt:write')" data-testid="empty-new-fragment" @click="openCreate('fragment')">+ New fragment</Button>
        </article>
      </div>
      <Button variant="link" v-if="!showArchived" data-testid="show-archived-empty" @click="showArchived = true; prompts.run()">Show archived prompts</Button>
    </section>

    <template v-else>
      <section v-if="summary.behind > 0" class="alert" data-testid="drift" role="status">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        <strong>{{ summary.behind }} {{ summary.behind === 1 ? "prompt runs" : "prompts run" }} behind the latest version in PRO</strong>
        <span class="alert-sub">{{ summary.waitingVersions }} {{ summary.waitingVersions === 1 ? "version is" : "versions are" }} waiting to be released</span>
        <span class="grow" />
        <Button v-if="status !== 'behind'" variant="danger" size="sm" data-testid="show-behind" @click="kind = 'prompts'; status = 'behind'">Show {{ summary.behind === 1 ? "it" : "them" }}</Button>
      </section>

      <div class="toolbar">
        <SegmentedControl v-model="kind" aria-label="What to list" :options="KIND_OPTIONS" />
        <label v-if="kind === 'prompts'" class="status-filter">Status
          <Select v-model="status" :options="STATUS_OPTIONS" aria-label="Release status" data-testid="status-filter" />
        </label>
        <span class="grow" />
        <Button v-if="kind === 'fragments' && can('prompt:write')" data-testid="new-fragment" @click="openCreate('fragment')">+ New fragment</Button>
        <Button variant="icon" aria-label="More options" data-testid="more-options">
          ⋯
          <Menu anchor="bottom right" self="top right" auto-close>
            <MenuItem :active="showArchived" data-testid="show-archived" @click="showArchived = !showArchived; prompts.run()">Show archived</MenuItem>
          </Menu>
        </Button>
      </div>

      <template v-if="kind === 'prompts'">
        <EmptyState v-if="rows.length === 0" icon="search_off" title="No matches">Try a different search or filter.</EmptyState>
        <DataTable v-else class="prompt-table" data-testid="prompt-table">
          <thead>
            <tr><th>Prompt</th><th>Latest</th><th>DEV</th><th>PRE</th><th>PRO</th><th class="num">Updated</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.prompt.id" class="row" :data-testid="`prompt-row-${r.prompt.name}`" tabindex="0" @click="open(r.prompt.id)" @keydown.enter="open(r.prompt.id)">
              <td class="who">
                <div class="who-name">
                  <span class="name">{{ r.prompt.name }}</span>
                  <Pill v-if="r.prompt.archivedAt" class="archived">archived</Pill>
                  <Pill v-if="awaitingMe.has(r.prompt.id)" :data-testid="`awaiting-${r.prompt.name}`" class="awaiting">needs your approval</Pill>
                  <span v-for="t in freeTags(r.prompt)" :key="t" class="free-tag mono" :data-testid="`tag-${r.prompt.name}-${t}`">{{ t }} → v{{ r.prompt.tags[t] }}</span>
                </div>
                <div v-if="r.prompt.description" class="desc">{{ r.prompt.description }}</div>
              </td>
              <td class="mono strong" :data-testid="`latest-${r.prompt.name}`">v{{ r.prompt.latestVersion }}</td>
              <td v-for="c in r.cells" :key="c.env">
                <span v-if="c.version === null" class="none" :data-testid="`tag-${r.prompt.name}-${c.env}`">—</span>
                <span v-else-if="c.behind > 0" class="chip late mono" :data-testid="`tag-${r.prompt.name}-${c.env}`">v{{ c.version }}<b>{{ c.behind }} behind</b></span>
                <span v-else class="chip mono" :class="c.env" :data-testid="`tag-${r.prompt.name}-${c.env}`">v{{ c.version }}</span>
              </td>
              <td class="num mono when">{{ formatDateTime(r.prompt.updatedAt) }}</td>
              <td class="sr-only" :data-testid="`release-${r.prompt.name}`">{{ r.release.state === "behind" ? `${r.release.behindBy} ${r.release.behindBy === 1 ? "version" : "versions"} behind in PRO` : r.release.state === "in_sync" ? "In sync" : "Not released" }}</td>
            </tr>
          </tbody>
        </DataTable>
      </template>

      <section v-else class="fragments" data-testid="fragments">
        <p class="soft small">Shared text that prompts include with <code>{{ sampleInclude }}</code>. Changing one proposes a new version of every prompt that uses it.</p>
        <p v-if="fragments.length === 0" class="soft small fragments-empty" data-testid="fragments-empty">No fragments yet.</p>
        <article
          v-for="f in shownFragments"
          :key="f.id"
          class="fragment-row"
          :data-testid="`fragment-row-${f.name}`"
          tabindex="0"
          @click="open(f.id)"
          @keydown.enter="open(f.id)"
        >
          <span class="name">{{ f.name }}</span>
          <Pill v-if="f.archivedAt" class="archived">archived</Pill>
          <span v-if="f.description" class="soft frag-desc">{{ f.description }}</span>
          <span class="grow" />
          <span class="mono">v{{ f.latestVersion }}</span>
          <Pill v-for="[tag, version] in sortEnvironments(Object.keys(f.tags)).map((t): [string, number] => [t, f.tags[t]!])" :key="tag" :class="tag" class="tag">{{ tag }} → v{{ version }}</Pill>
        </article>
      </section>
    </template>

    <Modal v-if="showCreate" :title="form.kind === 'fragment' ? 'New fragment' : 'New prompt'" :wide="true" @close="showCreate = false">
      <form class="modal-form" :class="{ split: form.kind === 'fragment' }" @submit.prevent="create">
        <p v-if="form.kind === 'fragment'" class="hint small intro" data-testid="fragment-hint">
          A fragment is text shared by several prompts (tone, policies, format). A prompt includes it with <code>{{ example("pro") }}</code>
          (by tag) or <code>{{ example("3") }}</code> (by version), and the version it points to when saving is pinned.
        </p>
        <div class="fields">
          <TextInput v-model="form.name" placeholder="name, e.g. weather-system" mono autofocus :invalid="!!fieldErrors.name" data-testid="prompt-name" />
          <p v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</p>
          <TextInput v-model="form.description" placeholder="What is it for? (optional)" />
          <PromptEditor v-model="form.content" :experiment-id="experimentId" :fragments="form.kind === 'prompt'" :rows="14" :invalid="!!fieldErrors.content" :placeholder="contentPlaceholder" testid="prompt-content" />
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
          <Button @click="showCreate = false">Cancel</Button>
          <Button variant="primary" type="submit" :disabled="creating || !form.name.trim() || !form.content.trim()" data-testid="create-prompt">{{ form.kind === "fragment" ? "Create fragment" : "Create" }}</Button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.awaiting { background: var(--mt-accent); color: var(--mt-accent-ink); }
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
.soft {
  color: var(--mt-muted);
  font-size: 12px;
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

.eyebrow {
  font-family: var(--mt-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--mt-accent);
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

/* ---- aviso de producción ---- */
.alert {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  box-sizing: border-box;
  padding: 0 9px 0 18px;
  border-radius: 10px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.alert strong {
  font-size: 14px;
  font-weight: 800;
}
.alert-sub {
  font-weight: 600;
  opacity: 0.85;
}
.grow {
  flex: 1;
}

/* ---- filtros ---- */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
}
.status-filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--mt-muted);
  font-weight: 600;
}

/* ---- tabla de prompts ---- */
.prompt-table .row {
  cursor: pointer;
}
.prompt-table .row:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: -2px;
}
.prompt-table :deep(td) {
  height: 56px;
}
.who {
  min-width: 0;
}
.who-name {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.name {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.desc {
  margin-top: 2px;
  max-width: 460px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--mt-muted);
}
.when {
  font-size: 11px;
  color: var(--mt-faint);
}
.free-tag {
  font-size: 11px;
  color: var(--mt-faint);
}
.none {
  color: var(--mt-faint);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  box-sizing: border-box;
  border: 1px solid var(--mt-soft);
  border-radius: var(--mt-radius-xs);
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 12px;
}
.chip.pre {
  border-color: var(--mt-warn-bg);
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.chip.pro {
  border-color: var(--mt-accent);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.chip.late {
  border-color: var(--mt-highlight);
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.chip b {
  font-family: var(--mt-font, inherit);
  font-size: 11px;
  font-weight: 800;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.archived {
  background: var(--mt-soft);
  color: var(--mt-muted);
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

.field-error {
  margin: -6px 0 0;
  font-size: 12px;
  color: var(--mt-err-ink);
}

</style>
