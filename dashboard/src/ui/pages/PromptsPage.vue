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
import { t, tp } from "../i18n";

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
    $q.notify({ message: t("promptsPage.the_prompt_name_is_not_registered", { name }), color: "warning", timeout: 5000 });
    return;
  }
  const version = typeof route.query.version === "string" ? route.query.version : undefined;
  void router.replace({ name: "prompt", params: { experimentId: experimentId.value, promptId: found.id }, query: { tab: "traces", ...(version ? { version } : {}) } });
});

// ---- una sola tabla: prompts y fragmentos (columna Type), con filtros en la URL ----
// `?type=fragment`, `?status=behind`; el valor por defecto no se escribe
type TypeFilter = "all" | "prompt" | "fragment";
type StatusFilter = "all" | ReleaseState;
const TYPE_VALUES: TypeFilter[] = ["all", "prompt", "fragment"];
const STATUS_VALUES: StatusFilter[] = ["all", "behind", "in_sync", "not_released"];
const typeFilter = computed<TypeFilter>({
  get: () => TYPE_VALUES.find((v) => v === route.query.type) ?? "all",
  set: (v) => void router.replace({ query: { ...route.query, type: v === "all" ? undefined : v } }),
});
const status = computed<StatusFilter>({
  get: () => STATUS_VALUES.find((v) => v === route.query.status) ?? "all",
  set: (v) => void router.replace({ query: { ...route.query, status: v === "all" ? undefined : v } }),
});
const items = computed(() => prompts.data.value ?? []);
const kindOf = (p: PromptSummaryDto): "prompt" | "fragment" => (p.kind === "fragment" ? "fragment" : "prompt");
const live = computed(() => items.value.filter((p) => !p.archivedAt));
const summary = computed(() => releaseSummary(live.value));
const TYPE_OPTIONS = computed(() => [
  { value: "all", label: t("promptsPage.all") },
  { value: "prompt", label: `${t("promptsPage.prompts")} · ${items.value.filter((p) => kindOf(p) === "prompt").length}` },
  { value: "fragment", label: `${t("promptsPage.fragments")} · ${items.value.filter((p) => kindOf(p) === "fragment").length}` },
]);
const STATUS_OPTIONS = computed(() => [
  { value: "all", label: t("promptsPage.all") },
  { value: "behind", label: `${t("promptsPage.behind_in_pro")} · ${summary.value.behind}` },
  { value: "in_sync", label: `${t("promptsPage.in_sync")} · ${summary.value.inSync}` },
  { value: "not_released", label: `${t("promptsPage.not_released")} · ${summary.value.notReleased}` },
]);

const search = ref("");
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter((p) => {
    if (typeFilter.value !== "all" && kindOf(p) !== typeFilter.value) return false;
    if (q && !p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) return false;
    return status.value === "all" || releaseStatus(p).state === status.value;
  });
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
const contentPlaceholder = computed(() => t("promptsPage.prompt_text_use_variable_for_the"));
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
    $q.notify({ message: t("promptsPage.could_not_create_the_prompt_error", { error: describeApiError(err) }), color: "negative", timeout: 4000 });
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Prompts' }, { label: 'Prompts' }]" icon="M4 6h16M4 12h16M4 18h10" title="Prompts">
      <div class="actions">
        <TextInput v-model="search" type="search" :placeholder="t('promptsPage.filter_by_name')" class="search" />
        <Button v-if="can('prompt:write')" data-testid="new-fragment" @click="openCreate('fragment')">{{ t("promptsPage.new_fragment2") }}</Button>
        <Button variant="primary" v-if="can('prompt:write')" data-testid="new-prompt" @click="openCreate('prompt')">{{ t("promptsPage.new_prompt2") }}</Button>
      </div>
    </PageHeader>

    <ApprovalInbox />

    <ErrorBanner v-if="prompts.error.value" :error="prompts.error.value" @retry="prompts.run()" />
    <LoadingState v-else-if="prompts.loading.value && !prompts.data.value" size="lg" />
    <section v-else-if="(prompts.data.value?.length ?? 0) === 0" class="welcome" data-testid="empty-state">
      <div class="welcome-head">
        <h2>{{ t("promptsPage.version_what_your_agent_says") }}</h2>
        <p>{{ t("promptsPage.every_save_is_a_version_tags") }}</p>
      </div>
      <div class="welcome-cards">
        <article class="welcome-card">
          <span class="eyebrow">{{ t("promptsPage.prompt") }}</span>
          <h3>{{ t("promptsPage.new_prompt") }}</h3>
          <p>{{ t("promptsPage.the_text_your_agent_runs_with") + " " }}<code>{{ sampleVariable }}</code>{{ " " + t("promptsPage.for_the_parts_that_change") }}</p>
          <pre class="sample">{{ t('promptsPage.you_are_a_weather_assistant_answer', { variable: sampleVariable }) }}</pre>
          <Button variant="primary" v-if="can('prompt:write')" data-testid="empty-new-prompt" @click="openCreate('prompt')">{{ t("promptsPage.new_prompt2") }}</Button>
        </article>
        <article class="welcome-card">
          <span class="eyebrow">{{ t("promptsPage.fragment") }}</span>
          <h3>{{ t("promptsPage.new_fragment") }}</h3>
          <p>{{ t("promptsPage.text_shared_by_several_prompts_tone") }}</p>
          <pre class="sample">{{ t('promptsPage.in_your_prompt_include', { include: sampleInclude }) }}</pre>
          <Button v-if="can('prompt:write')" data-testid="empty-new-fragment" @click="openCreate('fragment')">{{ t("promptsPage.new_fragment2") }}</Button>
        </article>
      </div>
      <Button variant="link" v-if="!showArchived" data-testid="show-archived-empty" @click="showArchived = true; prompts.run()">{{ t("promptsPage.show_archived_prompts") }}</Button>
    </section>

    <template v-else>
      <div class="toolbar">
        <label class="filter">{{ t("promptsPage.type") + " " }}<div class="filter-select"><Select v-model="typeFilter" :options="TYPE_OPTIONS" :aria-label="t('promptsPage.type')" data-testid="type-filter" /></div></label>
        <label class="filter">{{ t("promptsPage.status") + " " }}<div class="filter-select"><Select v-model="status" :options="STATUS_OPTIONS" :aria-label="t('promptsPage.release_status')" data-testid="status-filter" /></div></label>
        <span class="grow" />
        <span class="soft" data-testid="count">{{ tp("promptsPage.items", filtered.length) }}</span>
        <Button variant="icon" :aria-label="t('promptsPage.more_options')" data-testid="more-options">
          ⋯
          <Menu anchor="bottom right" self="top right" auto-close>
            <MenuItem :active="showArchived" data-testid="show-archived" @click="showArchived = !showArchived; prompts.run()">{{ t("promptsPage.show_archived") }}</MenuItem>
          </Menu>
        </Button>
      </div>

      <EmptyState v-if="rows.length === 0" icon="search_off" :title="t('promptsPage.no_matches')">{{ t("promptsPage.try_a_different_search_or_filter") }}</EmptyState>
      <DataTable v-else class="prompt-table" data-testid="prompt-table">
        <thead>
          <tr><th>{{ t("promptsPage.name") }}</th><th>{{ t("promptsPage.type") }}</th><th>{{ t("promptsPage.latest") }}</th><th>{{ t("promptsPage.dev") }}</th><th>{{ t("promptsPage.pre") }}</th><th>{{ t("promptsPage.pro") }}</th><th class="num">{{ t("promptsPage.updated") }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.prompt.id" class="prompt-row" :data-testid="`${r.prompt.kind === 'fragment' ? 'fragment' : 'prompt'}-row-${r.prompt.name}`" tabindex="0" @click="open(r.prompt.id)" @keydown.enter="open(r.prompt.id)">
            <td class="who">
              <div class="who-name">
                <span class="name">{{ r.prompt.name }}</span>
                <Pill v-if="r.prompt.archivedAt" class="archived">{{ t("promptsPage.archived") }}</Pill>
                <Pill v-if="awaitingMe.has(r.prompt.id)" :data-testid="`awaiting-${r.prompt.name}`" class="awaiting">{{ t("promptsPage.needs_your_approval") }}</Pill>
                <span v-for="t in freeTags(r.prompt)" :key="t" class="free-tag mono" :data-testid="`tag-${r.prompt.name}-${t}`">{{ t }} → v{{ r.prompt.tags[t] }}</span>
              </div>
              <div v-if="r.prompt.description" class="desc">{{ r.prompt.description }}</div>
              <span class="sr-only" :data-testid="`release-${r.prompt.name}`">{{ r.release.state === "behind" ? `${r.release.behindBy} ${r.release.behindBy === 1 ? "version" : "versions"} behind in PRO` : r.release.state === "in_sync" ? "In sync" : "Not released" }}</span>
            </td>
            <td class="type" :data-testid="`type-${r.prompt.name}`"><Pill v-if="r.prompt.kind === 'fragment'" tone="accent">{{ t("promptsPage.fragment2") }}</Pill><Pill v-else tone="info">{{ t("promptsPage.prompt2") }}</Pill></td>
            <td class="mono strong" :data-testid="`latest-${r.prompt.name}`">v{{ r.prompt.latestVersion }}</td>
            <td v-for="c in r.cells" :key="c.env">
              <span v-if="c.version === null" class="none" :data-testid="`tag-${r.prompt.name}-${c.env}`">—</span>
              <span v-else-if="c.behind > 0" class="chip late mono" :data-testid="`tag-${r.prompt.name}-${c.env}`">v{{ c.version }}<b>{{ t("promptsPage.count_behind", { count: c.behind }) }}</b></span>
              <span v-else class="chip mono" :class="c.env" :data-testid="`tag-${r.prompt.name}-${c.env}`">v{{ c.version }}</span>
            </td>
            <td class="num mono when">{{ formatDateTime(r.prompt.updatedAt) }}</td>
          </tr>
        </tbody>
      </DataTable>
    </template>

    <Modal v-if="showCreate" :title="form.kind === 'fragment' ? t('promptsPage.new_fragment') : t('promptsPage.new_prompt')" :wide="true" @close="showCreate = false">
      <form class="modal-form" :class="{ split: form.kind === 'fragment' }" @submit.prevent="create">
        <p v-if="form.kind === 'fragment'" class="hint small intro" data-testid="fragment-hint">
          {{ t("promptsPage.a_fragment_is_text_shared_by") + " " }}<code>{{ example("pro") }}</code>
          {{ t("promptsPage.by_tag_or") + " " }}<code>{{ example("3") }}</code>{{ " " + t("promptsPage.by_version_and_the_version_it") }}
        </p>
        <div class="fields">
          <TextInput v-model="form.name" :placeholder="t('promptsPage.name_e_g_weather_system')" mono autofocus :invalid="!!fieldErrors.name" data-testid="prompt-name" />
          <p v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</p>
          <TextInput v-model="form.description" :placeholder="t('promptsPage.what_is_it_for_optional')" />
          <PromptEditor v-model="form.content" :experiment-id="experimentId" :fragments="form.kind === 'prompt'" :rows="14" :invalid="!!fieldErrors.content" :placeholder="contentPlaceholder" testid="prompt-content" />
          <p v-if="fieldErrors.content" class="field-error">{{ fieldErrors.content }}</p>
          <TextInput v-model="form.message" :placeholder="t('promptsPage.message_for_version_1_optional')" />
        </div>
        <aside v-if="form.kind === 'fragment'" class="aside-cards">
          <div class="aside-card" data-testid="fragment-variables">
            <span class="eyebrow">{{ t("promptsPage.variables_it_brings") }}</span>
            <p class="soft small">{{ t("promptsPage.every_prompt_that_includes_it_gets") }}</p>
            <div class="vars">
              <code v-for="v in formVariables" :key="v" class="var">{{ asVariable(v) }}</code>
              <span v-if="formVariables.length === 0" class="soft small">{{ t("promptsPage.none_yet") }}</span>
            </div>
          </div>
          <div class="aside-card accent">
            <span class="eyebrow">{{ t("promptsPage.how_a_prompt_uses_it") }}</span>
            <p class="soft small">{{ t("promptsPage.pick_it_from") + " " }}<b>{{ t("promptsPage.insert_fragment") }}</b>{{ " " + t("promptsPage.in_the_prompt_editor_or_type") }}</p>
            <code class="snippet">{{ ownInclude }}</code>
            <p class="soft small">{{ t("promptsPage.the_tag_or_version_is_required") }}</p>
          </div>
        </aside>
        <div class="modal-foot">
          <span v-if="form.kind === 'fragment'" class="soft small">{{ t("promptsPage.creates_v1_published_nothing_runs_in") }}</span>
          <span class="grow" />
          <Button @click="showCreate = false">{{ t("promptsPage.cancel") }}</Button>
          <Button variant="primary" type="submit" :disabled="creating || !form.name.trim() || !form.content.trim()" data-testid="create-prompt">{{ form.kind === "fragment" ? t("promptsPage.create_fragment") : t("promptsPage.create") }}</Button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.awaiting { background: var(--mt-accent); color: var(--mt-accent-ink); }
code {
  font-family: var(--mt-mono);
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

/* ---- filtros ---- */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
}
.filter {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--mt-muted);
  font-weight: 600;
}
.filter-select {
  width: 200px;
}
.grow {
  flex: 1;
}

/* ---- tabla de prompts ---- */
.prompt-table .prompt-row {
  cursor: pointer;
}
.prompt-table .prompt-row:focus-visible {
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
