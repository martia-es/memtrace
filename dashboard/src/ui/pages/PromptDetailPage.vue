<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useQuasar } from "quasar";
import type { PromptDetailDto, PromptVersionDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime, formatRelativeTime } from "@/domain/format";
import { describeUsage, environmentsRunning, type UsageState } from "@/domain/prompt-usage";
import ErrorBanner from "../components/ErrorBanner.vue";
import PageHeader from "../components/PageHeader.vue";
import PromptDiff from "../components/PromptDiff.vue";
import Select from "../components/Select.vue";
import TabBar from "../components/TabBar.vue";
import TextInput from "../components/TextInput.vue";
import { useAsync } from "../composables/useAsync";
import { usePermissions } from "../composables/usePermissions";
import { usePromptApi } from "../composables/usePromptApi";

const props = defineProps<{ promptId: string }>();
const api = usePromptApi();
const route = useRoute();
const $q = useQuasar();
const { can } = usePermissions();

const detail = useAsync((signal) => api.get(props.promptId, signal));
void detail.run();

const data = computed<PromptDetailDto | null>(() => detail.data.value);
const versions = computed(() => data.value?.versions ?? []);
const archived = computed(() => !!data.value?.prompt.archivedAt);
const canWrite = computed(() => can("prompt:write") && !archived.value);
const canPromote = computed(() => can("prompt:promote") && !archived.value);

// ---- selección ----
const selected = ref<number | null>(null);
watch(versions, (list) => {
  if (list.length > 0 && (selected.value === null || !list.some((v) => v.version === selected.value))) selected.value = list[0]!.version;
}, { immediate: true });
const selectedVersion = computed<PromptVersionDto | null>(() => versions.value.find((v) => v.version === selected.value) ?? null);

const usageRows = computed(() => describeUsage(data.value?.usage ?? [], data.value?.tags ?? []));
const running = (version: number) => environmentsRunning(data.value?.usage ?? [], version);
const USAGE_LABEL: Record<UsageState, string> = { in_sync: "Up to date", behind: "Catching up", pinned: "Fixed version", stale: "Not reporting" };
const nowMs = Date.now();

const tagsByVersion = computed(() => {
  const map = new Map<number, string[]>();
  for (const t of data.value?.tags ?? []) map.set(t.version, [...(map.get(t.version) ?? []), t.tag]);
  return map;
});

// ---- pestañas ----
const TABS = [
  { id: "content", label: "Content" },
  { id: "compare", label: "Compare" },
  { id: "tags", label: "Tags & history" },
];
const tab = ref(TABS.some((t) => t.id === route.query.tab) ? String(route.query.tab) : "content");

// ---- comparar ----
const compareWith = ref<number | null>(null);
const olderVersions = computed(() => versions.value.filter((v) => v.version !== selected.value));
watch([selectedVersion, versions], () => {
  const v = selectedVersion.value;
  if (!v) return;
  // por defecto, contra la versión de la que partió (o la anterior)
  const fallback = versions.value.find((o) => o.version < v.version)?.version ?? null;
  compareWith.value = v.parentVersion ?? fallback;
}, { immediate: true });
const compareVersion = computed(() => versions.value.find((v) => v.version === compareWith.value) ?? null);
const compareOptions = computed(() => olderVersions.value.map((v) => ({ label: `v${v.version}${v.message ? ` · ${v.message}` : ""}`, value: v.version })));

// ---- guardar versión ----
const editing = ref(false);
const draft = ref("");
const message = ref("");
const saving = ref(false);
function startEdit() {
  draft.value = selectedVersion.value?.content ?? "";
  message.value = "";
  editing.value = true;
}
function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
}
async function saveVersion() {
  saving.value = true;
  try {
    const saved = await api.saveVersion(props.promptId, { content: draft.value, message: message.value, parentVersion: selected.value });
    editing.value = false;
    await detail.run();
    selected.value = saved.version;
    tab.value = "content";
    $q.notify({ message: `Saved as v${saved.version}`, color: "positive", timeout: 2500 });
  } catch (error) {
    notifyError("Could not save the version", error);
  } finally {
    saving.value = false;
  }
}

// ---- tags ----
const environmentKeys = computed(() => data.value?.environmentKeys ?? []);
const tagVersion = (tag: string): number | null => data.value?.tags.find((t) => t.tag === tag)?.version ?? null;
const freeTags = computed(() => (data.value?.tags ?? []).filter((t) => !environmentKeys.value.includes(t.tag)));
const versionOptions = computed(() => versions.value.map((v) => ({ label: `v${v.version}${v.message ? ` · ${v.message}` : ""}`, value: v.version })));
const reason = ref("");
const pending = ref<Record<string, number | null>>({});
const newTag = ref("");
const moving = ref(false);

async function moveTag(tag: string, version: number | null) {
  moving.value = true;
  try {
    await api.moveTag(props.promptId, tag, version, reason.value);
    reason.value = "";
    delete pending.value[tag];
    await detail.run();
    $q.notify({ message: version === null ? `Tag "${tag}" removed` : `"${tag}" now points to v${version}`, color: "positive", timeout: 2500 });
  } catch (error) {
    notifyError("Could not move the tag", error);
  } finally {
    moving.value = false;
  }
}
async function addFreeTag() {
  const tag = newTag.value.trim();
  if (!tag || selected.value === null) return;
  await moveTag(tag, selected.value);
  newTag.value = "";
}

// ---- archivar ----
async function toggleArchived() {
  try {
    await api.update(props.promptId, { archived: !archived.value });
    await detail.run();
  } catch (error) {
    notifyError(archived.value ? "Could not restore the prompt" : "Could not archive the prompt", error);
  }
}

const agentLabel = computed(() => route.params.experimentId as string);
/** Cómo se escribe la variable en el texto del prompt. */
const asVariable = (name: string) => `{{${name}}}`;
</script>

<template>
  <div class="page">
    <PageHeader
      :crumbs="[{ label: 'Prompts' }, { label: 'Prompts', to: { name: 'prompts', params: { experimentId: agentLabel } } }, { label: data?.prompt.name ?? 'Prompt' }]"
      icon="M4 6h16M4 12h16M4 18h10"
      :title="data?.prompt.name ?? 'Prompt'"
    >
      <div class="actions">
        <span v-if="archived" class="mt-pill archived" data-testid="archived-badge">archived</span>
        <button v-if="can('prompt:write')" type="button" class="ghost-btn" data-testid="toggle-archived" @click="toggleArchived">{{ archived ? "Restore" : "Archive" }}</button>
      </div>
    </PageHeader>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="detail.run()" />
    <div v-else-if="!data" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-else>
      <p v-if="data.prompt.description" class="muted description">{{ data.prompt.description }}</p>
      <div class="body">
        <aside class="mt-card versions" aria-label="Versions">
          <button
            v-for="v in versions"
            :key="v.version"
            type="button"
            class="version"
            :class="{ active: v.version === selected }"
            :data-testid="`version-${v.version}`"
            @click="selected = v.version"
          >
            <span class="version-head">
              <strong class="mono">v{{ v.version }}</strong>
              <span v-for="tag in tagsByVersion.get(v.version) ?? []" :key="tag" class="mt-pill tag">{{ tag }}</span>
            </span>
            <span v-if="running(v.version).length > 0" class="running" :data-testid="`running-${v.version}`">Running in {{ running(v.version).join(", ") }}</span>
            <span class="version-msg">{{ v.message || "No message" }}</span>
            <span class="muted version-date mono">{{ formatDateTime(v.createdAt) }}</span>
          </button>
        </aside>

        <section class="mt-card detail">
          <TabBar v-model="tab" :tabs="TABS" />

          <div v-if="tab === 'content' && selectedVersion" class="pane" data-testid="pane-content">
            <div v-if="!editing">
              <div class="pane-head">
                <div class="vars">
                  <span class="muted">Variables:</span>
                  <code v-for="name in selectedVersion.variables" :key="name" class="var">{{ asVariable(name) }}</code>
                  <span v-if="selectedVersion.variables.length === 0" class="muted">none</span>
                </div>
                <button v-if="canWrite" type="button" class="primary-btn" data-testid="edit-version" @click="startEdit">Edit as new version</button>
              </div>
              <pre class="content" data-testid="version-content">{{ selectedVersion.content }}</pre>
            </div>
            <form v-else class="editor" @submit.prevent="saveVersion">
              <p class="muted">Editing from v{{ selected }}. Saving creates a new version; the previous ones are not modified.</p>
              <TextInput v-model="draft" multiline :rows="16" mono data-testid="editor" />
              <TextInput v-model="message" placeholder="What changed and why? (optional)" data-testid="version-message" />
              <div class="row">
                <button type="submit" class="primary-btn" :disabled="saving || !draft.trim() || draft === selectedVersion.content" data-testid="save-version">Save as new version</button>
                <button type="button" class="ghost-btn" @click="editing = false">Cancel</button>
              </div>
            </form>
          </div>

          <div v-else-if="tab === 'compare' && selectedVersion" class="pane" data-testid="pane-compare">
            <div class="compare-bar">
              <span class="muted">Compare v{{ selectedVersion.version }} with</span>
              <Select v-if="compareOptions.length > 0" v-model="compareWith" :options="compareOptions" data-testid="compare-with" />
              <span v-else class="muted">nothing: this is the first version</span>
            </div>
            <PromptDiff v-if="compareVersion" :old-text="compareVersion.content" :new-text="selectedVersion.content" :old-label="`v${compareVersion.version}`" :new-label="`v${selectedVersion.version}`" />
          </div>

          <div v-else-if="tab === 'tags'" class="pane" data-testid="pane-tags">
            <h3>In use right now</h3>
            <p v-if="usageRows.length === 0" class="muted small" data-testid="usage-empty">
              No agent has reported this prompt yet. It shows up here once an agent loads it with <code>memtrace.prompts.get()</code>.
            </p>
            <table v-else class="tags" data-testid="usage-table">
              <tbody>
                <tr v-for="u in usageRows" :key="`${u.experimentId}-${u.environment}-${u.tag}-${u.version}`" :data-testid="`usage-${u.environment || 'none'}-v${u.version}`">
                  <td class="mono tag-name">{{ u.environment || "no environment" }}</td>
                  <td class="mono">v{{ u.version }}</td>
                  <td class="muted">{{ u.tag ? `follows “${u.tag}”` : "fixed version" }}</td>
                  <td><span class="mt-pill usage" :class="u.state">{{ USAGE_LABEL[u.state] }}</span></td>
                  <td v-if="u.state === 'behind'" class="muted small">“{{ u.tag }}” now points to v{{ u.tagVersion }}</td>
                  <td v-else class="muted small">{{ formatRelativeTime(u.lastSeenAt, nowMs) }}</td>
                </tr>
              </tbody>
            </table>

            <h3>Environments</h3>
            <p class="muted small">The tag decides which version each environment uses. Moving one needs the promote permission.</p>
            <TextInput v-if="canPromote || canWrite" v-model="reason" placeholder="Reason for the change (optional, saved in the history)" data-testid="tag-reason" />
            <table class="tags">
              <tbody>
                <tr v-for="key in environmentKeys" :key="key" :data-testid="`env-${key}`">
                  <td class="mono tag-name">{{ key }}</td>
                  <td class="mono">{{ tagVersion(key) === null ? "—" : `v${tagVersion(key)}` }}</td>
                  <td v-if="canPromote" class="move">
                    <Select :model-value="pending[key] ?? null" :options="versionOptions" placeholder="Point to…" @update:model-value="pending[key] = $event" />
                    <button type="button" class="primary-btn small" :disabled="moving || pending[key] == null || pending[key] === tagVersion(key)" :data-testid="`move-${key}`" @click="moveTag(key, pending[key]!)">Move</button>
                    <button v-if="tagVersion(key) !== null" type="button" class="ghost-btn small" @click="moveTag(key, null)">Remove</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <h3>Other tags</h3>
            <table v-if="freeTags.length > 0" class="tags">
              <tbody>
                <tr v-for="t in freeTags" :key="t.tag">
                  <td class="mono tag-name">{{ t.tag }}</td>
                  <td class="mono">v{{ t.version }}</td>
                  <td v-if="canWrite"><button type="button" class="ghost-btn small" @click="moveTag(t.tag, null)">Remove</button></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="muted small">No free tags.</p>
            <form v-if="canWrite && selected !== null" class="row" @submit.prevent="addFreeTag">
              <TextInput v-model="newTag" placeholder="new-tag" mono size="sm" data-testid="new-tag" />
              <button type="submit" class="ghost-btn small" :disabled="moving || !newTag.trim()" data-testid="add-tag">Tag v{{ selected }}</button>
            </form>

            <h3>History</h3>
            <p v-if="data.events.length === 0" class="muted small">No tag has been moved yet.</p>
            <ul v-else class="events" data-testid="tag-events">
              <li v-for="ev in data.events" :key="ev.id">
                <span class="mono">{{ ev.tag }}</span>
                {{ ev.toVersion === null ? "removed (was" : "moved from" }}
                <span class="mono">{{ ev.fromVersion === null ? "none" : `v${ev.fromVersion}` }}</span>
                <template v-if="ev.toVersion !== null"> to <span class="mono">v{{ ev.toVersion }}</span></template><template v-else>)</template>
                <span class="muted"> · {{ formatDateTime(ev.createdAt) }}</span>
                <span v-if="ev.reason" class="muted"> · “{{ ev.reason }}”</span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.muted {
  color: var(--mt-muted);
}
.small {
  font-size: 12.5px;
  margin: 0;
}
.description {
  margin: 0;
  font-size: 13px;
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 12px;
}
.versions {
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 0;
}
.version {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid var(--mt-line-2);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.version:hover {
  background: var(--mt-soft-2);
}
.version.active {
  background: var(--mt-accent-soft);
}
.version-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.version-msg {
  font-size: 12.5px;
}
.version-date {
  font-size: 11px;
}
.tag {
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
}
.version.active .tag {
  background: var(--mt-card);
}
.archived {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.running {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--mt-ok-ink);
}
.usage.in_sync {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.usage.behind {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.usage.pinned {
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
}
.usage.stale {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}
.pane-head,
.compare-bar,
.row,
.move {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pane-head {
  justify-content: space-between;
}
.vars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}
.var {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--mt-soft);
}
.content {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
  font-family: var(--mt-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h3 {
  margin: 8px 0 0;
  font-size: 13px;
}
.tags {
  border-collapse: collapse;
  font-size: 13px;
}
.tags td {
  padding: 6px 12px 6px 0;
  vertical-align: middle;
}
.tag-name {
  font-weight: 700;
  min-width: 80px;
}
.events {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.primary-btn,
.ghost-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--mt-radius-lg);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn {
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.ghost-btn {
  border: 1px solid var(--mt-line);
  background: transparent;
  color: var(--mt-ink);
}
.primary-btn.small,
.ghost-btn.small {
  height: 30px;
  padding: 0 12px;
  font-size: 12.5px;
}
.primary-btn:disabled,
.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (max-width: 900px) {
  .body {
    grid-template-columns: 1fr;
  }
}
</style>
