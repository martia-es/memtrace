<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useQuasar } from "quasar";
import type { PromptDetailDto, PromptVersionDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { formatCostUsd, formatCount, formatDateTime, formatDuration, formatPercent, formatRelativeTime } from "@/domain/format";
import { MIN_TRACES, compareVersions, evaluatorCell, evaluatorNames, sampleQuality } from "@/domain/prompt-evidence";
import { requestTitle } from "@/domain/approvals";
import { describeUsage, environmentsRunning, followersOf, followSnippet, tagNameError, type UsageState } from "@/domain/prompt-usage";
import { sortEnvironments, splitVariables } from "@/domain/prompt-release";
import { includeSyntax } from "@/domain/prompt-fragment";
import { sideBySideDiff } from "@/domain/text-diff";
import EnvFlag from "../components/EnvFlag.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import PageHeader from "../components/PageHeader.vue";
import PromotePromptModal from "../components/PromotePromptModal.vue";
import PromptApprovals from "../components/PromptApprovals.vue";
import RequestApprovalModal from "../components/RequestApprovalModal.vue";
import PromptDependencyMap from "../components/PromptDependencyMap.vue";
import PromptEditor from "../components/PromptEditor.vue";
import PromptFixFromFailure from "../components/PromptFixFromFailure.vue";
import PromptPlayground from "../components/PromptPlayground.vue";
import PromptDiff from "../components/PromptDiff.vue";
import Select from "../components/Select.vue";
import TextInput from "../components/TextInput.vue";
import PromptTraces from "../components/PromptTraces.vue";
import PromptVersionList from "../components/PromptVersionList.vue";
import TabBar from "../components/TabBar.vue";
import { useAssistantAccess } from "../composables/useAssistantAccess";
import { useAsync } from "../composables/useAsync";
import { usePermissions } from "../composables/usePermissions";
import { usePromptApi } from "../composables/usePromptApi";
import { useTraceApi } from "../composables/useTraceApi";
import Button from "../components/Button.vue";
import Pill from "../components/Pill.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";
import Disclosure from "../components/Disclosure.vue";
import SegmentedControl from "../components/SegmentedControl.vue";

const props = defineProps<{ promptId: string }>();
const api = usePromptApi();
const route = useRoute();
const $q = useQuasar();
const { can } = usePermissions();

const detail = useAsync((signal) => api.get(props.promptId, signal));
void detail.run();

const data = computed<PromptDetailDto | null>(() => detail.data.value);
/** Autor de una versión o de un movimiento de tag; null si no se conoce (usuario borrado o sistema). */
const authorName = (userId: string | null): string | null => (userId ? data.value?.people?.[userId] ?? null : null);
const versions = computed(() => data.value?.versions ?? []);
const archived = computed(() => !!data.value?.prompt.archivedAt);
const canWrite = computed(() => can("prompt:write") && !archived.value);
const canPromote = computed(() => can("prompt:promote") && !archived.value);

// ---- selección ----
// `?version=N` (desde una traza, conversación o evaluación) abre esa versión
const fromLink = Number(route.query.version);
const selected = ref<number | null>(Number.isInteger(fromLink) && fromLink > 0 ? fromLink : null);
watch(versions, (list) => {
  if (list.length > 0 && (selected.value === null || !list.some((v) => v.version === selected.value))) selected.value = (list.find((v) => v.status === "published") ?? list[0]!).version;
}, { immediate: true });
const selectedVersion = computed<PromptVersionDto | null>(() => versions.value.find((v) => v.version === selected.value) ?? null);

const usageRows = computed(() => describeUsage(data.value?.usage ?? [], data.value?.tags ?? []));
const running = (version: number) => environmentsRunning(data.value?.usage ?? [], version);
const USAGE_LABEL: Record<UsageState, string> = { in_sync: "Up to date", behind: "Catching up", pinned: "Fixed version", stale: "Not reporting" };
const nowMs = Date.now();

const tagsByVersion = computed(() => {
  const map = new Map<number, string[]>();
  for (const t of data.value?.tags ?? []) map.set(t.version, [...(map.get(t.version) ?? []), t.tag]);
  for (const [version, tags] of map) map.set(version, sortEnvironments(tags));
  return map;
});

// ---- lista de versiones: las fijadas por tag van arriba (el buscador y la agrupación viven en PromptVersionList) ----
const pinned = computed(() =>
  sortEnvironments((data.value?.tags ?? []).map((t) => t.tag)).map((tag) => {
    const version = tagVersion(tag)!;
    return { tag, version, message: versions.value.find((v) => v.version === version)?.message ?? "" };
  }),
);

// ---- franja de entornos: qué versión corre en cada uno, cuánto va por detrás y la acción para ponerla al día ----
const latestVersion = computed(() => versions.value.find((v) => v.status === "published")?.version ?? 0);
const tagVersionMap = computed(() => Object.fromEntries((data.value?.tags ?? []).map((t) => [t.tag, t.version])));
const envCards = computed(() =>
  environmentKeys.value.map((key) => {
    const version = tagVersion(key);
    return { key, version, behind: version === null ? null : Math.max(0, latestVersion.value - version), usage: usageOf(key) };
  }),
);
/** Pone un entorno en la última versión publicada, por la misma vía que Release (aprobación o gate si toca). */
function promoteLatest(key: string) {
  if (latestVersion.value === 0) return;
  pending.value[key] = latestVersion.value;
  moveEnvironment(key);
}

// ---- dos columnas: entornos y versiones a la izquierda; la versión elegida a la derecha, con sus pestañas ----
type Mode = "text" | "compare" | "evidence" | "try" | "fix";
type Drawer = "rules" | "activity" | "usedby";
type ViewTab = "prompt" | "changes" | "behaviour" | "test";
const TAB_OF: Record<Mode, ViewTab> = { text: "prompt", compare: "changes", evidence: "behaviour", try: "test", fix: "test" };
const TAB_ROOT: Record<ViewTab, Mode> = { prompt: "text", changes: "compare", behaviour: "evidence", test: "try" };
// enlaces antiguos (?tab=...) siguen funcionando: abren la vista o el panel que corresponde
const LEGACY_TAB: Record<string, { mode?: Mode; drawer?: Drawer }> = {
  compare: { mode: "compare" }, try: { mode: "try" }, fix: { mode: "fix" }, evidence: { mode: "evidence" },
  tags: { drawer: "rules" }, approvals: { drawer: "rules" }, traces: { drawer: "usedby" }, map: { drawer: "usedby" },
};
const legacy = LEGACY_TAB[String(route.query.tab)] ?? {};
const fixTrace = typeof route.query.trace === "string" && route.query.tab === "fix" ? route.query.trace : null;
const replayTrace = ref<string | null>(typeof route.query.trace === "string" ? route.query.trace : null);
const mode = ref<Mode>(legacy.mode ?? "text");
const drawer = ref<Drawer | null>(legacy.drawer ?? null);
// ancho del panel lateral: se arrastra por el borde izquierdo o se amplía con el botón
const DRAWER_MIN = 480;
const DRAWER_DEFAULT = 620;
const drawerWidth = ref(DRAWER_DEFAULT);
const drawerWide = computed(() => drawerWidth.value > DRAWER_DEFAULT);
const clampDrawer = (w: number) => Math.max(DRAWER_MIN, Math.min(w, window.innerWidth - 40));
function toggleDrawerWidth() {
  drawerWidth.value = drawerWide.value ? DRAWER_DEFAULT : clampDrawer(Math.round(window.innerWidth * 0.8));
}
function startDrawerResize(e: PointerEvent) {
  const move = (ev: PointerEvent) => (drawerWidth.value = clampDrawer(window.innerWidth - ev.clientX));
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  e.preventDefault();
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}
const activeTab = computed(() => TAB_OF[mode.value]);
const VIEW_TABS = [
  { id: "prompt", label: "Prompt" },
  { id: "changes", label: "Changes" },
  { id: "behaviour", label: "Behaviour" },
  { id: "test", label: "Test" },
];
function openTab(id: string) {
  if (TAB_OF[mode.value] !== id) mode.value = TAB_ROOT[id as ViewTab];
}
const TEST_OPTIONS = [{ value: "try", label: "Try it", testid: "sub-try" }, { value: "fix", label: "Fix a failure", testid: "sub-fix" }];
const drawerTabs = computed(() => [
  { id: "rules", label: "Rules" },
  { id: "activity", label: "Activity", ...(openRequests.value.length > 0 ? { count: `${openRequests.value.length} pending` } : {}) },
  { id: "usedby", label: "Used by" },
]);
const allVersionOptions = computed(() => versions.value.map((v) => ({ label: `v${v.version}${v.message ? ` · ${v.message}` : ""}`, value: v.version })));
function pick(version: number) {
  selected.value = version;
}

// ---- evidencia (ADR-069) ----
const RANGES = [
  { value: "24h", label: "24 hours", ms: 24 * 3600_000 },
  { value: "7d", label: "7 days", ms: 7 * 24 * 3600_000 },
  { value: "30d", label: "30 days", ms: 30 * 24 * 3600_000 },
];
const rangeKey = ref("7d");
const rangeOptions = RANGES.map((r) => ({ label: r.label, value: r.value }));
const rangeLabel = computed(() => RANGES.find((r) => r.value === rangeKey.value)?.label ?? "");
const evidence = useAsync((signal) => {
  const ms = RANGES.find((r) => r.value === rangeKey.value)!.ms;
  const to = new Date();
  return api.getEvidence(String(route.params.experimentId), props.promptId, { from: new Date(to.getTime() - ms), to }, signal);
});
let evidenceLoadedFor: string | null = null;
function ensureEvidence() {
  if (evidenceLoadedFor === rangeKey.value) return;
  evidenceLoadedFor = rangeKey.value;
  void evidence.run();
}
watch([mode, rangeKey], () => {
  if (mode.value === "evidence" || mode.value === "compare") ensureEvidence();
}, { immediate: true });
const evidenceVersions = computed(() => evidence.data.value?.versions ?? []);
const evaluatorColumns = computed(() => evaluatorNames(evidenceVersions.value));
const evidenceOf = (version: number | null) => evidenceVersions.value.find((v) => v.version === version) ?? null;
const comparison = computed(() => {
  const base = evidenceOf(compareWith.value);
  const target = evidenceOf(selected.value);
  return base && target ? compareVersions(base, target) : null;
});
const missingEvidence = computed(() => [compareWith.value, selected.value].filter((v): v is number => v !== null && evidenceOf(v) === null));
const TEXT_VIEW_OPTIONS = [{ value: "source", label: "Source", testid: "view-source" }, { value: "resolved", label: "Resolved", testid: "view-resolved" }];
const USAGE_TONE: Record<UsageState, "ok" | "highlight" | "info" | "neutral"> = { in_sync: "ok", behind: "highlight", pinned: "info", stale: "neutral" };
const DIRECTION_TONE = { better: "ok", worse: "error", same: "neutral", unknown: "neutral" } as const;
const DIRECTION_LABEL = { better: "Better", worse: "Worse", same: "No change", unknown: "–" } as const;

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
  draft.value = selectedVersion.value?.source ?? selectedVersion.value?.content ?? "";
  message.value = "";
  editing.value = true;
}
function notifyError(action: string, error: unknown) {
  $q.notify({ message: `${action}: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
}
async function saveVersion(asDraft = false) {
  saving.value = true;
  try {
    const saved = await api.saveVersion(props.promptId, { content: draft.value, message: message.value, parentVersion: selected.value, draft: asDraft });
    editing.value = false;
    await detail.run();
    selected.value = saved.version;
    mode.value = "text";
    const needsApproval = !asDraft && saved.status === "draft";
    $q.notify({
      message: asDraft ? `Saved as draft v${saved.version}` : needsApproval ? `Saved as draft v${saved.version}: publishing it needs approval` : `Saved as v${saved.version}`,
      color: "positive",
      timeout: needsApproval ? 5000 : 2500,
    });
  } catch (error) {
    notifyError("Could not save the version", error);
  } finally {
    saving.value = false;
  }
}

// ---- fragmentos (ADR-073) ----
/** Ejemplo de inclusión para el texto de ayuda (`}}` dentro de una plantilla de Vue la rompe). */
const includeExample = (name: string) => includeSyntax(name, "pro");
const isLatestPublished = computed(() => selectedVersion.value !== null && selectedVersion.value.version === latestVersion.value);
/** versión a la que resuelve hoy una inclusión de la última versión publicada si ya no es la fijada; null si sigue igual */
const includeOutdated = (name: string, ref: string): number | null => {
  const status = data.value?.includes.find((i) => i.name === name && i.ref === ref);
  return status?.outdated && isLatestPublished.value ? status.current : null;
};
const anyOutdated = computed(() => (data.value?.includes ?? []).some((i) => i.outdated));
const outdatedDependents = computed(() => (data.value?.usedBy ?? []).filter((u) => u.outdated).length);
async function rebuildPrompt() {
  draftBusy.value = true;
  try {
    const saved = await api.rebuild(props.promptId);
    await detail.run();
    selected.value = saved.version;
    $q.notify({ message: `Draft v${saved.version} saved with the current fragments`, color: "positive", timeout: 3000 });
  } catch (error) {
    notifyError("Could not rebuild", error);
  } finally {
    draftBusy.value = false;
  }
}
async function rebuildDependents() {
  draftBusy.value = true;
  try {
    const { created, skipped } = await api.rebuildDependents(props.promptId);
    await detail.run();
    const skippedNote = skipped.length > 0 ? `, ${skipped.length} skipped` : "";
    $q.notify({ message: `${created.length} ${created.length === 1 ? "draft" : "drafts"} created${skippedNote}. Review them in each prompt`, color: skipped.length > 0 ? "warning" : "positive", timeout: 5000 });
  } catch (error) {
    notifyError("Could not rebuild the prompts that use it", error);
  } finally {
    draftBusy.value = false;
  }
}

// ---- aprobaciones (ADR-076) ----
const approvalInfo = useAsync((signal) => api.getApprovals(props.promptId, signal));
void approvalInfo.run();
const openRequests = computed(() => (approvalInfo.data.value?.requests ?? []).filter((r) => r.status === "pending"));
const approvalRules = computed(() => data.value?.approvals ?? { publish: false, promote: [] });
/** Lo que se está pidiendo aprobar: publicar un borrador o apuntar un entorno a una versión. */
const requesting = ref<{ action: "publish" | "promote"; version: number; tag?: string } | null>(null);
/** Volver a una versión que el entorno ya sirvió sin saltarse el gate es un rollback: no pide aprobación. */
const servedBefore = (tag: string, version: number) => (data.value?.events ?? []).some((e) => e.tag === tag && e.toVersion === version && !e.gateBypassed);
const needsApproval = (tag: string, version: number) => approvalRules.value.promote.includes(tag) && !servedBefore(tag, version);
async function onRequested() {
  await detail.run();
  drawer.value = "rules";
  void approvalInfo.run();
}

// ---- borradores (ADR-072) ----
const isDraft = computed(() => selectedVersion.value?.status === "draft");
const draftCount = computed(() => versions.value.filter((v) => v.status === "draft").length);
const draftBusy = ref(false);
async function publishSelected() {
  if (selected.value === null) return;
  draftBusy.value = true;
  try {
    await api.publishDraft(props.promptId, selected.value);
    await detail.run();
    $q.notify({ message: `v${selected.value} published. It can take tags now`, color: "positive", timeout: 3000 });
  } catch (error) {
    notifyError("Could not publish the draft", error);
  } finally {
    draftBusy.value = false;
  }
}
async function discardSelected() {
  if (selected.value === null) return;
  const gone = selected.value;
  draftBusy.value = true;
  try {
    await api.discardDraft(props.promptId, gone);
    selected.value = null;
    await detail.run();
    $q.notify({ message: `Draft v${gone} discarded`, color: "positive", timeout: 3000 });
  } catch (error) {
    notifyError("Could not discard the draft", error);
  } finally {
    draftBusy.value = false;
  }
}
// probar un borrador en el asistente real: él y la versión de la que parte, con el caso que se quería arreglar
const tryFirst = ref<number | null>(null);
const trySecond = ref<number | null>(null);
function testDraft(draftVersion: number, base: number | null, traceId: string | null) {
  tryFirst.value = draftVersion;
  trySecond.value = base;
  if (traceId) replayTrace.value = traceId;
  mode.value = "try";
}
async function onDraftSaved(version: number) {
  await detail.run();
  selected.value = version;
}

// ---- tags ----
const environmentKeys = computed(() => data.value?.environmentKeys ?? []);
const tagVersion = (tag: string): number | null => data.value?.tags.find((t) => t.tag === tag)?.version ?? null;
const freeTags = computed(() => (data.value?.tags ?? []).filter((t) => !environmentKeys.value.includes(t.tag)));
const versionOptions = computed(() => versions.value.filter((v) => v.status === "published").map((v) => ({ label: `v${v.version}${v.message ? ` · ${v.message}` : ""}`, value: v.version })));
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
const newTagError = computed(() => (newTag.value.trim() ? tagNameError(newTag.value.trim(), environmentKeys.value) : null));
async function addFreeTag() {
  const tag = newTag.value.trim();
  if (!tag || selected.value === null || newTagError.value) return;
  await moveTag(tag, selected.value);
  newTag.value = "";
}
const followers = (tag: string) => followersOf(usageRows.value, tag);
const snippetOf = (tag: string) => followSnippet(data.value?.prompt.name ?? "", tag);
const copiedTag = ref<string | null>(null);
async function copySnippet(tag: string) {
  try {
    await navigator.clipboard.writeText(snippetOf(tag));
    copiedTag.value = tag;
    setTimeout(() => (copiedTag.value = null), 1200);
  } catch {
    /* clipboard unavailable */
  }
}

// ---- promoción con garantías (ADR-070) ----
const traceApi = useTraceApi();
const access = useAssistantAccess(() => String(route.params.experimentId));
const policy = computed(() => data.value?.policy ?? null);
const gated = computed(() => data.value?.gatedEnvironments ?? []);
const isProtected = (key: string) => policy.value !== null && gated.value.includes(key);

const promoting = ref<{ tag: string; version: number } | null>(null);
function moveEnvironment(tag: string) {
  const version = pending.value[tag];
  if (version == null) return;
  // con una regla de aprobación para este entorno no se mueve directamente: se pide (ADR-076)
  if (needsApproval(tag, version)) {
    requesting.value = { action: "promote", version, tag };
    return;
  }
  // con política, los entornos protegidos pasan por el modal que enseña el veredicto del gate
  if (isProtected(tag)) promoting.value = { tag, version };
  else void moveTag(tag, version);
}
async function onPromoted() {
  const done = promoting.value;
  if (done) delete pending.value[done.tag];
  reason.value = "";
  await detail.run();
}

const datasets = useAsync((signal) => traceApi.listDatasets(signal));
let datasetsRequested = false;
watch(drawer, (d) => {
  if (d === "rules" && !datasetsRequested) {
    datasetsRequested = true;
    void datasets.run();
  }
}, { immediate: true });
const datasetOptions = computed(() => (datasets.data.value?.items ?? []).map((d) => ({ label: d.name, value: d.id })));
const datasetName = (id: string | null) => (id === null ? null : (datasets.data.value?.items.find((d) => d.id === id)?.name ?? "unknown dataset"));
const editingPolicy = ref(false);
const policyDataset = ref<string | null>(null);
const policyRuns = ref(1);
const savingPolicy = ref(false);
function startPolicy() {
  policyDataset.value = policy.value?.datasetId ?? null;
  policyRuns.value = policy.value?.requiredRuns ?? 1;
  editingPolicy.value = true;
}
async function savePolicy() {
  if (policyDataset.value === null) return;
  savingPolicy.value = true;
  try {
    await api.setPolicy(props.promptId, { datasetId: policyDataset.value, requiredRuns: Number(policyRuns.value) });
    editingPolicy.value = false;
    await detail.run();
  } catch (error) {
    notifyError("Could not save the policy", error);
  } finally {
    savingPolicy.value = false;
  }
}
async function removePolicy() {
  try {
    await api.deletePolicy(props.promptId);
    await detail.run();
  } catch (error) {
    notifyError("Could not remove the policy", error);
  }
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

// ---- contenido: líneas numeradas con las variables resaltadas y las líneas que cambian respecto a la versión de la que parte ----
const parentOfSelected = computed(() => {
  const v = selectedVersion.value;
  if (!v) return null;
  return versions.value.find((o) => o.version === v.parentVersion) ?? versions.value.find((o) => o.version < v.version) ?? null;
});
const changedLines = computed(() => {
  const v = selectedVersion.value;
  const parent = parentOfSelected.value;
  const changed = new Set<number>();
  if (!v || !parent) return changed;
  let n = 0;
  for (const row of sideBySideDiff(parent.content, v.content)) {
    if (row.right.kind === "empty") continue;
    n += 1;
    if (row.right.kind === "add") changed.add(n);
  }
  return changed;
});
// una versión con fragmentos se lee como la escribió quien la editó, con sus `{{> nombre@tag}}`; «Resolved» es lo que recibe el agente (ADR-073)
const hasIncludes = computed(() => (selectedVersion.value?.includes.length ?? 0) > 0);
const view = ref<"source" | "resolved">("source");
const showingSource = computed(() => hasIncludes.value && view.value === "source");
const codeLines = computed(() =>
  (showingSource.value ? (selectedVersion.value?.source ?? "") : (selectedVersion.value?.content ?? "")).split("\n").map((text, i) => ({ n: i + 1, parts: splitVariables(text), heading: text.startsWith("#"), changed: !showingSource.value && changedLines.value.has(i + 1) })),
);

// ---- evidencia: qué falló más, sumando las causas de todas las versiones ----
const failures = computed(() => {
  const byTitle = new Map<string, { title: string; traces: number; versions: number[] }>();
  for (const e of evidenceVersions.value) {
    for (const c of e.errorCauses) {
      const entry = byTitle.get(c.title) ?? { title: c.title, traces: 0, versions: [] };
      entry.traces += c.traces;
      entry.versions.push(e.version);
      byTitle.set(c.title, entry);
    }
  }
  return [...byTitle.values()].sort((a, b) => b.traces - a.traces).slice(0, 5);
});
/** Promote la versión que se está viendo al entorno: pasa por la solicitud de aprobación o el gate igual que desde Release. */
const canPromoteSelected = computed(() => canPromote.value && selectedVersion.value?.status === "published");
function promoteSelected(tag: string) {
  if (selected.value === null) return;
  pending.value[tag] = selected.value;
  moveEnvironment(tag);
}
const maxTraces = computed(() => Math.max(1, ...evidenceVersions.value.map((e) => e.traces)));
const maxFailure = computed(() => Math.max(1, ...failures.value.map((f) => f.traces)));
const messageOf = (version: number | null) => versions.value.find((v) => v.version === version)?.message ?? "";
const usageOf = (env: string) => usageRows.value.find((u) => u.environment === env) ?? null;
</script>

<template>
  <div class="page">
    <PageHeader
      :crumbs="[{ label: 'Prompts' }, { label: 'Prompts', to: { name: 'prompts', params: { experimentId: agentLabel } } }, { label: data?.prompt.name ?? 'Prompt' }]"
      icon="M4 6h16M4 12h16M4 18h10"
      :title="data?.prompt.name ?? 'Prompt'"
    >
      <div class="actions">
        <Pill v-if="archived" data-testid="archived-badge" class="archived">archived</Pill>
        <Button v-if="can('prompt:write')" data-testid="toggle-archived" @click="toggleArchived">{{ archived ? "Restore" : "Archive" }}</Button>
      </div>
    </PageHeader>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="detail.run()" />
    <LoadingState v-else-if="!data" size="lg" />

    <template v-else>
      <section class="title-row">
        <p class="description" data-testid="description">{{ data.prompt.description }}</p>
        <span class="grow" />
        <Button data-testid="open-rules" @click="drawer = 'rules'">Rules &amp; approvals</Button>
        <Button data-testid="open-usedby" @click="drawer = 'usedby'">Used by</Button>
      </section>

      <div class="split">
        <aside class="side" aria-label="Environments and versions">
          <span class="eyebrow">ENVIRONMENTS</span>
          <div v-if="envCards.length > 0" class="env-list" data-testid="env-strip">
            <div v-for="e in envCards" :key="e.key" class="env-card" :class="{ late: e.behind !== null && e.behind > 0 && e.key === 'pro' }" :data-testid="`env-card-${e.key}`">
              <EnvFlag :env="e.key" />
              <div class="env-card-body">
                <strong class="mono env-card-ver">{{ e.version === null ? "—" : `v${e.version}` }}</strong>
                <span class="env-card-note" :class="{ late: e.behind !== null && e.behind > 0 }" :data-testid="`env-note-${e.key}`">
                  {{ e.version === null ? "Not set" : e.behind === 0 ? "Up to date" : `${e.behind} ${e.behind === 1 ? "version" : "versions"} behind` }}
                </span>
              </div>
              <Button
                v-if="canPromote && latestVersion > 0 && e.version !== latestVersion"
                size="sm"
                :variant="e.key === 'pro' ? 'primary' : 'secondary'"
                :disabled="moving"
                :data-testid="`promote-${e.key}`"
                @click="promoteLatest(e.key)"
              >{{ needsApproval(e.key, latestVersion) ? "Request approval" : `Promote v${latestVersion}` }}</Button>
            </div>
          </div>
          <div class="versions-box" data-testid="versions-box">
            <PromptVersionList :versions="versions" :selected="selected" :tags-by-version="tagsByVersion" :pinned="[]" :running="running" :author-name="authorName" @pick="pick" />
          </div>
        </aside>

        <div class="detail">
          <header v-if="selectedVersion" class="vhead" data-testid="version-head">
            <strong class="mono vnum" data-testid="version-picker">v{{ selected }}</strong>
            <EnvFlag v-for="tag in tagsByVersion.get(selected ?? -1) ?? []" :key="tag" :env="tag" />
            <Pill v-if="isDraft" class="draft-pill">draft</Pill>
            <span v-if="selectedVersion.message" class="vmsg">{{ selectedVersion.message }}</span>
            <span class="soft">Saved {{ formatDateTime(selectedVersion.createdAt) }}<template v-if="authorName(selectedVersion.createdBy)"> · {{ authorName(selectedVersion.createdBy) }}</template><template v-if="parentOfSelected"> · from v{{ parentOfSelected.version }}</template></span>
            <span class="grow" />
            <Button variant="primary" v-if="canWrite && mode === 'text' && !editing" data-testid="edit-version" @click="startEdit">Edit as new version</Button>
          </header>
          <TabBar :tabs="VIEW_TABS" :model-value="activeTab" @update:model-value="openTab" />

          <template v-if="mode === 'text'">
            <div v-if="selectedVersion" class="pane" data-testid="pane-content">
              <section v-if="isDraft && !editing && selectedVersion" class="draft-banner" data-testid="draft-banner">
                <div>
                  <b>Draft — not reviewed yet.</b> It has no tag and no environment can use it.
                  <template v-if="approvalRules.publish"> It needs approval before it can be published.</template>
                  <template v-if="selectedVersion.origin">
                    <p class="small" data-testid="draft-origin">
                      Proposed to fix <span v-if="selectedVersion.origin.cause">“{{ selectedVersion.origin.cause }}”</span>
                      <template v-if="selectedVersion.origin.traceIds.length > 0">
                        (<router-link v-for="t in selectedVersion.origin.traceIds" :key="t" :to="{ name: 'trace', params: { experimentId: String(route.params.experimentId), traceId: t } }" class="link mono">{{ t.slice(0, 8) }}</router-link>)
                      </template>.
                    </p>
                    <p v-if="selectedVersion.origin.rationale" class="small soft" data-testid="draft-rationale">{{ selectedVersion.origin.rationale }}</p>
                  </template>
                </div>
                <div v-if="canWrite" class="draft-actions">
                  <Button data-testid="draft-test" @click="testDraft(selectedVersion.version, selectedVersion.parentVersion, selectedVersion.origin?.traceIds[0] ?? null)">Test it</Button>
                  <Button variant="primary" v-if="approvalRules.publish" :disabled="draftBusy" data-testid="draft-request" @click="requesting = { action: 'publish', version: selectedVersion.version }">Request approval</Button>
                  <Button variant="primary" v-else :disabled="draftBusy" data-testid="draft-publish" @click="publishSelected">Publish</Button>
                  <Button :disabled="draftBusy" data-testid="draft-discard" @click="discardSelected">Discard</Button>
                </div>
              </section>
              <section v-if="!editing && data.prompt.kind === 'fragment' && outdatedDependents > 0" class="dependents-banner" data-testid="dependents-banner">
                <div>
                  <b>{{ outdatedDependents }} {{ outdatedDependents === 1 ? "prompt still includes" : "prompts still include" }} an older version of this fragment.</b>
                  <p class="small">Nothing changes in production by itself. MemTrace can prepare a draft in {{ outdatedDependents === 1 ? "it" : "each one" }}; you review, test it in the playground and publish.</p>
                </div>
                <Button variant="primary" v-if="canWrite" :disabled="draftBusy" data-testid="rebuild-dependents" @click="rebuildDependents">
                  Prepare {{ outdatedDependents === 1 ? "a draft" : `drafts for ${outdatedDependents} prompts` }}
                </Button>
              </section>
              <div v-if="!editing" class="content-grid">
                <div class="code-card">
                  <div v-if="hasIncludes" class="code-head">
                    <span class="grow" />
                    <SegmentedControl size="sm" class="view-toggle" aria-label="Text shown" :options="TEXT_VIEW_OPTIONS" :model-value="view" @update:model-value="view = $event as typeof view" />
                  </div>
                  <pre class="code" data-testid="version-content"><span v-for="line in codeLines" :key="line.n" class="ln" :class="{ changed: line.changed, heading: line.heading }"><span v-for="(part, i) in line.parts" :key="i" :class="{ variable: part.variable }">{{ part.text }}</span></span></pre>
                  <div v-if="!showingSource && changedLines.size > 0" class="code-foot"><i /> Lines changed since v{{ parentOfSelected?.version }}</div>
                  <div class="props" data-testid="props">
                    <div class="prop" data-testid="variables-card">
                      <span class="eyebrow">VARIABLES</span>
                      <code v-for="name in selectedVersion.variables" :key="name" class="var">{{ asVariable(name) }}</code>
                      <span v-if="selectedVersion.variables.length === 0" class="soft">none</span>
                    </div>
                    <div v-if="hasIncludes" class="prop" data-testid="includes-card">
                      <span class="eyebrow">INCLUDES</span>
                      <span v-for="i in selectedVersion.includes" :key="`${i.name}@${i.ref}`" class="include" :data-testid="`include-${i.name}`">
                        <router-link :to="{ name: 'prompts', params: { experimentId: String(route.params.experimentId) } }" class="link mono">{{ i.name }}@{{ i.ref }}</router-link>
                        → <b class="mono">v{{ i.version }}</b>
                        <Pill v-if="includeOutdated(i.name, i.ref)" :data-testid="`outdated-${i.name}`" class="draft-pill">now v{{ includeOutdated(i.name, i.ref) }}</Pill>
                      </span>
                      <Button variant="primary" size="sm" v-if="canWrite && isLatestPublished && anyOutdated" :disabled="draftBusy" data-testid="rebuild" @click="rebuildPrompt">Rebuild with the current fragments</Button>
                    </div>
                    <div v-if="data.prompt.kind === 'fragment'" class="prop used-by" data-testid="used-by-card">
                      <span class="eyebrow">USED BY</span>
                      <span v-if="data.usedBy.length === 0" class="soft" data-testid="used-by-empty">No prompt includes this fragment yet. Write <code>{{ includeExample(data.prompt.name) }}</code> in a prompt to use it.</span>
                      <span v-for="u in data.usedBy" :key="u.promptId" class="include" :data-testid="`used-by-${u.name}`">
                        <router-link :to="{ name: 'prompt', params: { experimentId: String(route.params.experimentId), promptId: u.promptId } }" class="link mono">{{ u.name }}</router-link> <span class="soft">v{{ u.version }}</span>
                        <Pill v-if="u.outdated" class="draft-pill">behind</Pill>
                        <Pill v-else class="ok-pill">up to date</Pill>
                      </span>
                    </div>
                  </div>
                </div>

              </div>
              <div v-else class="editor-layout">
                <form class="editor" @submit.prevent="saveVersion(false)">
                  <p class="muted">Editing from v{{ selected }}. Saving creates a new version; the previous ones are not modified.</p>
                  <PromptEditor v-model="draft" :experiment-id="String(route.params.experimentId)" :fragments="data.prompt.kind !== 'fragment'" :rows="18" />
                  <TextInput v-model="message" placeholder="What changed and why? (optional)" data-testid="version-message" />
                  <div class="row">
                    <Button variant="primary" type="submit" :disabled="saving || !draft.trim() || draft === (selectedVersion.source ?? selectedVersion.content)" data-testid="save-version">Save as new version</Button>
                    <Button :disabled="saving || !draft.trim() || draft === (selectedVersion.source ?? selectedVersion.content)" data-testid="save-draft" @click="saveVersion(true)">Save as draft</Button>
                    <Button @click="editing = false">Cancel</Button>
                  </div>
                </form>
              </div>
            </div>
          </template>
          <div v-else class="view" :data-testid="`view-${mode}`">
            <SegmentedControl v-if="mode === 'try' || mode === 'fix'" class="test-switch" size="sm" aria-label="Kind of test" :options="TEST_OPTIONS" :model-value="mode" @update:model-value="mode = $event as Mode" />
            <div v-if="mode === 'compare' && selectedVersion" class="pane" data-testid="pane-compare">
              <div class="compare-bar compare-toolbar">
                <span class="muted">Compare</span>
                <div class="bar-select"><Select v-model="selected" :options="allVersionOptions" data-testid="compare-version" /></div>
                <span class="muted">with</span>
                <div v-if="compareOptions.length > 0" class="bar-select"><Select v-model="compareWith" :options="compareOptions" data-testid="compare-with" /></div>
                <span v-else class="muted">nothing: this is the first version</span>
                <span class="grow" />
                <template v-if="compareVersion">
                  <span class="muted">behaviour over the last</span>
                  <div class="bar-select"><Select v-model="rangeKey" :options="rangeOptions" data-testid="behaviour-range" /></div>
                </template>
              </div>
              <section v-if="compareVersion" class="behaviour" data-testid="behaviour">
                <LoadingState v-if="evidence.loading.value && !evidence.data.value" size="md" />
                <p v-else-if="evidence.error.value" class="muted small" data-testid="behaviour-error">Could not load the evidence: {{ evidence.error.value.message }}</p>
                <p v-else-if="!comparison" class="muted small" data-testid="behaviour-empty">
                  No traces used {{ missingEvidence.map((v) => `v${v}`).join(" or ") }} in the last {{ rangeLabel }}, so there is nothing to compare yet.
                </p>
                <template v-else>
                  <p v-if="!comparison.reliable" class="warn-banner small" data-testid="behaviour-unreliable">
                    <svg class="warn-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3 2 20h20L12 3Zm0 6v5m0 3v.01" /></svg>
                    At least one of the two versions has fewer than {{ MIN_TRACES }} traces: treat these differences as indicative, they may be chance.
                  </p>
                  <div class="tiles" data-testid="behaviour-table">
                    <div v-for="d in comparison.deltas" :key="d.key" class="tile" :data-testid="`delta-${d.key}`">
                      <span class="eyebrow">{{ d.label.toUpperCase() }}</span>
                      <div class="tile-value"><strong>{{ d.target }}</strong><span class="soft">was {{ d.base }}</span></div>
                      <Pill :class="d.direction" class="direction">{{ d.change }} · {{ DIRECTION_LABEL[d.direction] }}</Pill>
                      <div v-if="d.bars" class="bars" aria-hidden="true">
                        <span class="bar base"><i :style="{ width: `${Math.max(2, d.bars.base * 100)}%` }" /></span>
                        <span class="bar target" :class="d.direction"><i :style="{ width: `${Math.max(2, d.bars.target * 100)}%` }" /></span>
                      </div>
                      <span class="sr-only">v{{ compareVersion.version }} {{ d.base }}, v{{ selectedVersion.version }} {{ d.target }}</span>
                    </div>
                  </div>
                </template>
              </section>
              <PromptDiff v-if="compareVersion" :old-text="compareVersion.content" :new-text="selectedVersion.content" :old-label="`v${compareVersion.version}`" :new-label="`v${selectedVersion.version}`" />
            </div>
            <div v-if="mode === 'fix'" class="pane" data-testid="pane-fix">
              <PromptFixFromFailure
                :experiment-id="String(route.params.experimentId)"
                :prompt-id="promptId"
                :prompt-name="data.prompt.name"
                :versions="versions"
                :selected="selected"
                :usage="data.usage"
                :initial-trace="fixTrace"
                @saved="onDraftSaved"
                @test="(draftVersion, base, traceId) => testDraft(draftVersion, base, traceId)"
              />
            </div>
            <div v-if="mode === 'try'" class="pane" data-testid="pane-try">
              <PromptPlayground
                :experiment-id="String(route.params.experimentId)"
                :prompt-id="promptId"
                :versions="versions"
                :selected="selected"
                :usage="data.usage"
                :initial-trace="replayTrace"
                :initial-first="tryFirst"
                :initial-second="trySecond"
              />
            </div>
            <div v-if="mode === 'evidence'" class="pane" data-testid="pane-evidence">
              <div class="compare-bar">
                <span class="muted">Traces of the last</span>
                <div class="bar-select"><Select v-model="rangeKey" :options="rangeOptions" data-testid="evidence-range" /></div>
                <span class="grow" />
                <span class="soft">A trace counts for every version it used.</span>
              </div>
              <ErrorBanner v-if="evidence.error.value" :error="evidence.error.value" @retry="evidence.run()" />
              <LoadingState v-else-if="evidence.loading.value && !evidence.data.value" size="md" />
              <p v-else-if="evidenceVersions.length === 0" class="muted small" data-testid="evidence-empty">
                No trace used this prompt in the last {{ rangeLabel }}. Traces show up here when an agent calls <code>compile()</code> inside a traced step.
              </p>
              <template v-else>
                <div class="table-scroll evidence-card">
                  <table class="evidence" data-testid="evidence-table">
                    <thead>
                      <tr>
                        <th>Version</th><th>Traces</th><th>Errors</th><th class="num">Latency p95</th><th class="num">Cost / trace</th><th class="num">User approval</th>
                        <th v-for="name in evaluatorColumns" :key="name" class="num">{{ name }}</th>
                        <th>Main failure</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="e in evidenceVersions" :key="e.version" :data-testid="`evidence-v${e.version}`">
                        <td class="mono">
                          <strong>v{{ e.version }}</strong>
                          <span class="env-stack"><EnvFlag v-for="tag in tagsByVersion.get(e.version) ?? []" :key="tag" :env="tag" /></span>
                        </td>
                        <td class="mono">
                          <span class="cell-top">{{ formatCount(e.traces) }}<Pill v-if="sampleQuality(e.traces) === 'low'" :title="`Fewer than ${MIN_TRACES} traces: the figures are only indicative`" class="low-sample">few traces</Pill></span>
                          <span class="meter"><span :style="{ width: `${Math.max(3, (e.traces / maxTraces) * 100)}%` }" /></span>
                        </td>
                        <td class="mono" :class="{ bad: e.errorRate >= 0.1 }">
                          <span class="cell-top">{{ formatPercent(e.errorRate) }}</span>
                          <span class="meter" :class="{ bad: e.errorRate >= 0.1 }"><span :style="{ width: `${Math.min(100, e.errorRate * 800)}%` }" /></span>
                        </td>
                        <td class="num mono">{{ formatDuration(e.latencyMs.p95) }}</td>
                        <td class="num mono">{{ formatCostUsd(e.costPerTraceUsd) ?? "–" }}<span v-if="e.costPerTraceUsd !== null && !e.costComplete" class="muted" title="Some model has no known price: the real cost is higher"> +</span></td>
                        <td class="num mono">{{ e.feedback.satisfaction === null ? "–" : `${e.feedback.satisfaction.toFixed(0)}%` }}<span v-if="e.feedback.ratedTraces > 0" class="muted"> ({{ e.feedback.ratedTraces }})</span></td>
                        <td v-for="name in evaluatorColumns" :key="name" class="num mono"><span class="score">{{ evaluatorCell(e, name) }}</span></td>
                        <td>
                          <span v-if="e.errorCauses.length === 0" class="muted">–</span>
                          <span v-else :data-testid="`cause-v${e.version}`">{{ e.errorCauses[0]!.title }} <span class="muted">({{ e.errorCauses[0]!.traces }})</span></span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div v-if="failures.length > 0" class="failures" data-testid="failures">
                  <span class="eyebrow">WHAT FAILED MOST</span>
                  <p class="soft">Main failure causes across these versions, by number of traces.</p>
                  <div v-for="f in failures" :key="f.title" class="failure">
                    <span class="failure-title">{{ f.title }}</span>
                    <span class="failure-bar"><span :style="{ width: `${(f.traces / maxFailure) * 100}%` }" /></span>
                    <strong class="mono">{{ f.traces }}</strong>
                    <span class="soft">{{ f.versions.map((v) => `v${v}`).join(", ") }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <Transition name="drawer-fade">
          <div v-if="drawer" class="drawer-backdrop" data-testid="drawer-backdrop" @click="drawer = null" />
        </Transition>
        <Transition name="drawer-slide">
        <aside v-if="drawer" class="drawer" role="dialog" aria-label="Rules, activity and dependencies" data-testid="drawer" :style="{ width: `min(${drawerWidth}px, 100vw)` }">
          <div class="drawer-resize" role="separator" aria-orientation="vertical" aria-label="Resize panel" data-testid="drawer-resize" @pointerdown="startDrawerResize" @dblclick="toggleDrawerWidth" />
          <header class="drawer-head">
            <strong>{{ drawer === "rules" ? "Rules & approvals" : drawer === "activity" ? "Activity" : "Used by" }}</strong>
            <span class="grow" />
            <Button variant="icon" :aria-label="drawerWide ? 'Narrow panel' : 'Widen panel'" data-testid="drawer-widen" @click="toggleDrawerWidth">{{ drawerWide ? "⇥" : "⇤" }}</Button>
            <Button variant="icon" aria-label="Close" data-testid="drawer-close" @click="drawer = null">×</Button>
          </header>
          <TabBar :tabs="drawerTabs" :model-value="drawer" @update:model-value="drawer = $event as Drawer" />
          <div class="drawer-body">
            <div v-if="drawer === 'rules'" class="pane tags-pane" data-testid="pane-tags">
              <TextInput v-if="canPromote || canWrite" v-model="reason" placeholder="Reason for the change (optional, saved in the history)" data-testid="tag-reason" />

              <section class="card tags-card">
                <header class="card-head"><h3>Tags</h3><span class="muted small">Each tag points to one version. Moving an environment needs the promote permission.</span></header>
                <div class="env-card" v-for="key in environmentKeys" :key="key" :data-testid="`env-${key}`">
                  <span class="env-badge" :class="key"><b>{{ key.toUpperCase() }}</b></span>
                  <strong class="mono env-ver">{{ tagVersion(key) === null ? "—" : `v${tagVersion(key)}` }}</strong>
                  <span class="env-msg">{{ messageOf(tagVersion(key)) || "No message" }}</span>
                  <Pill v-if="isProtected(key)" title="Needs a passing evaluation to be promoted" :data-testid="`protected-${key}`" class="protected">protected</Pill>
                  <span class="env-usage">
                    <template v-if="usageOf(key)">
                      <span class="soft">{{ usageOf(key)!.state === "behind" ? `agent on v${usageOf(key)!.version}` : formatRelativeTime(usageOf(key)!.lastSeenAt, nowMs) }}</span>
                      <Pill :tone="USAGE_TONE[usageOf(key)!.state]" class="usage">{{ USAGE_LABEL[usageOf(key)!.state] }}</Pill>
                    </template>
                    <span v-else class="soft">No agent has reported this environment yet.</span>
                  </span>
                  <div v-if="canPromote" class="move">
                    <Select :model-value="pending[key] ?? tagVersion(key)" :options="versionOptions" placeholder="Point to…" @update:model-value="pending[key] = $event" />
                    <Button size="sm" :disabled="moving || pending[key] == null || pending[key] === tagVersion(key)" :data-testid="`move-${key}`" @click="moveEnvironment(key)">{{ pending[key] != null && needsApproval(key, pending[key]!) ? "Request approval" : "Move" }}</Button>
                    <Button variant="icon" v-if="tagVersion(key) !== null" :aria-label="`Remove the ${key} tag`" title="Remove the tag" @click="moveTag(key, null)">×</Button>
                  </div>
                </div>
                <div class="other-tags">
                  <div class="other-head">
                    <strong>Custom tags</strong>
                    <span class="soft">No approval needed</span>
                  </div>
                  <p class="soft other-help">
                    A custom tag is a channel with your own name. An agent follows it with <code>tag="canary"</code> and receives the version it points to, so moving the tag updates the agent without a deploy.
                  </p>
                  <div v-for="t in freeTags" :key="t.tag" class="free-card" :data-testid="`free-tag-${t.tag}`">
                    <div class="free-row">
                      <span class="free-tag mono">{{ t.tag }}</span>
                      <strong class="mono">v{{ t.version }}</strong>
                      <span class="grow"></span>
                      <div v-if="canWrite" class="move">
                        <Select :model-value="pending[t.tag] ?? t.version" :options="versionOptions" placeholder="Point to…" @update:model-value="pending[t.tag] = $event" />
                        <Button size="sm" :disabled="moving || pending[t.tag] == null || pending[t.tag] === t.version" :data-testid="`move-${t.tag}`" @click="moveTag(t.tag, pending[t.tag]!)">Move</Button>
                        <Button variant="icon" :aria-label="`Remove the ${t.tag} tag`" title="Remove the tag" @click="moveTag(t.tag, null)">×</Button>
                      </div>
                    </div>
                    <ul v-if="followers(t.tag).length" class="followers" :data-testid="`followers-${t.tag}`">
                      <li v-for="u in followers(t.tag)" :key="`${u.experimentId}-${u.environment}-${u.version}`">
                        <Pill :tone="USAGE_TONE[u.state]" class="usage">{{ USAGE_LABEL[u.state] }}</Pill>
                        <span>{{ u.environment || "no environment" }} · running <strong class="mono">v{{ u.version }}</strong></span>
                        <span class="grow"></span>
                        <span class="soft">{{ formatRelativeTime(u.lastSeenAt, nowMs) }}</span>
                      </li>
                    </ul>
                    <div v-else class="no-followers" :data-testid="`no-followers-${t.tag}`">
                      <strong>No agent follows this tag yet</strong>
                      <span>Paste this in the agent.</span>
                      <div class="snippet">
                        <code>{{ snippetOf(t.tag) }}</code>
                        <button type="button" class="copy" @click="copySnippet(t.tag)">{{ copiedTag === t.tag ? "Copied" : "Copy" }}</button>
                      </div>
                    </div>
                  </div>
                  <p v-if="freeTags.length === 0" class="soft">No custom tags yet.</p>
                  <form v-if="canWrite && selected !== null" class="add-tag" @submit.prevent="addFreeTag">
                    <TextInput v-model="newTag" placeholder="new-tag" mono size="sm" data-testid="new-tag" />
                    <Button variant="primary" size="sm" type="submit" :disabled="moving || !newTag.trim() || !!newTagError" data-testid="add-tag">Tag v{{ selected }}</Button>
                  </form>
                  <p v-if="newTagError" class="soft tag-error" data-testid="new-tag-error">{{ newTagError }}</p>
                  <p v-else class="soft">Lowercase letters, digits, “-” and “_”, starting with a letter. dev, pre and pro are environments and have their own rules.</p>
                </div>
              </section>

              <section class="card policy-card">
                <header class="card-head"><h3>Promotion policy</h3></header>
                <div class="card-body">
                <div v-if="!editingPolicy" data-testid="policy">
                  <p v-if="!policy" class="muted small" data-testid="policy-none">
                    No policy: any version can be promoted. Add one to require a passing evaluation before {{ gated.join(" and ") || "protected environments" }} can use a version.
                  </p>
                  <template v-else>
                    <p class="small" data-testid="policy-summary">
                      A version needs <b>{{ policy.requiredRuns }}</b> passing evaluation{{ policy.requiredRuns > 1 ? "s in a row" : "" }} on
                      <b>{{ datasetName(policy.datasetId) ?? "a dataset that no longer exists" }}</b> to be promoted to {{ gated.join(" or ") }}.
                      <span v-if="policy.datasetId === null" class="warn" data-testid="policy-broken">The dataset was deleted: promotions are blocked until you choose another.</span>
                    </p>
                    <p class="muted small">The evaluation has to run with the agent reading that exact version through <code>memtrace.prompts</code>. Each evaluator must reach its target pass rate.</p>
                  </template>
                  <div v-if="canPromote" class="row">
                    <Button size="sm" data-testid="edit-policy" @click="startPolicy">{{ policy ? "Edit policy" : "Add policy" }}</Button>
                    <Button size="sm" v-if="policy" data-testid="remove-policy" @click="removePolicy">Remove policy</Button>
                  </div>
                </div>
                <form v-else class="policy-form" data-testid="policy-form" @submit.prevent="savePolicy">
                  <div class="row">
                    <span class="muted">Evaluate against</span>
                    <Select v-model="policyDataset" :options="datasetOptions" placeholder="Choose a dataset…" data-testid="policy-dataset" />
                  </div>
                  <div class="row">
                    <span class="muted">Passing runs in a row</span>
                    <input v-model.number="policyRuns" type="number" min="1" max="10" class="runs" data-testid="policy-runs" />
                  </div>
                  <p class="muted small">Protected: {{ gated.join(", ") || "none" }}. {{ environmentKeys[0] ?? "The first environment" }} stays free to iterate.</p>
                  <div class="row">
                    <Button variant="primary" size="sm" type="submit" :disabled="savingPolicy || policyDataset === null" data-testid="save-policy">Save policy</Button>
                    <Button size="sm" @click="editingPolicy = false">Cancel</Button>
                  </div>
                </form>
                </div>
              </section>
              <div data-testid="pane-approvals">
              <PromptApprovals :prompt-id="promptId" :environments="environmentKeys" @changed="detail.run(); approvalInfo.run()" />
              </div>
            </div>
            <div v-if="drawer === 'activity'" class="pane tags-pane" data-testid="pane-activity">
              <details class="card usage-fold" :open="usageRows.length === 0">
                <summary>In use right now <span class="muted">({{ usageRows.length }})</span></summary>
                <p v-if="usageRows.length === 0" class="muted small" data-testid="usage-empty">
                  No agent has reported this prompt yet. It shows up here once an agent loads it with <code>memtrace.prompts.get()</code>.
                </p>
                <table v-else class="tags" data-testid="usage-table">
                  <tbody>
                    <tr v-for="u in usageRows" :key="`${u.experimentId}-${u.environment}-${u.tag}-${u.version}`" :data-testid="`usage-${u.environment || 'none'}-v${u.version}`">
                      <td class="mono tag-name">{{ u.environment || "no environment" }}</td>
                      <td class="mono">v{{ u.version }}</td>
                      <td class="muted">{{ u.tag ? `follows “${u.tag}”` : "fixed version" }}</td>
                      <td><Pill :tone="USAGE_TONE[u.state]" class="usage">{{ USAGE_LABEL[u.state] }}</Pill></td>
                      <td v-if="u.state === 'behind'" class="muted small">“{{ u.tag }}” now points to v{{ u.tagVersion }}</td>
                      <td v-else class="muted small">{{ formatRelativeTime(u.lastSeenAt, nowMs) }}</td>
                    </tr>
                  </tbody>
                </table>
              </details>

              <section class="card history">
                <header class="card-head"><h3>History</h3><span class="muted small">Every tag move, newest first.</span></header>
                <p v-if="data.events.length === 0" class="empty muted small">No tag has been moved yet.</p>
                <ul v-else class="events" data-testid="tag-events">
                  <li v-for="ev in data.events" :key="ev.id">
                    <i class="dot" :class="environmentKeys.includes(ev.tag) ? ev.tag : 'free'" />
                    <span class="ev-what mono">
                      <b>{{ ev.tag }}</b>
                      <template v-if="ev.toVersion === null"> removed (was {{ ev.fromVersion === null ? "none" : `v${ev.fromVersion}` }})</template>
                      <template v-else-if="ev.fromVersion === null"> added at v{{ ev.toVersion }}</template>
                      <template v-else> v{{ ev.fromVersion }} → v{{ ev.toVersion }}</template>
                    </span>
                    <span class="ev-note">
                      <template v-if="ev.reason">“{{ ev.reason }}”</template>
                      <span v-if="ev.gateBypassed" class="warn" :data-testid="`bypassed-${ev.id}`"> skipped the evaluation: “{{ ev.bypassReason }}”</span>
                      <span v-if="authorName(ev.changedBy)" class="muted" :data-testid="`event-author-${ev.id}`"> by {{ authorName(ev.changedBy) }}</span>
                    </span>
                    <span class="ev-date mono">{{ formatDateTime(ev.createdAt) }}</span>
                  </li>
                </ul>
              </section>

            </div>
            <div v-if="drawer === 'usedby'" class="pane used-pane" data-testid="pane-usedby">
              <h3 class="sub-title">Traces</h3>
            <div class="pane" data-testid="pane-traces">
              <PromptTraces :prompt-name="data.prompt.name" :versions="versionOptions.map((o) => Number(o.value))" :selected="selected" />
            </div>
              <h3 class="sub-title">Dependencies</h3>
            <div class="pane" data-testid="pane-map">
              <PromptDependencyMap :prompt-id="promptId" :kind="data.prompt.kind" :name="data.prompt.name" :tag-versions="tagVersionMap" :latest="latestVersion" />
            </div>
            </div>
          </div>
        </aside>
        </Transition>
    </template>

    <RequestApprovalModal
      v-if="requesting"
      :prompt-id="promptId"
      :action="requesting.action"
      :version="requesting.version"
      :tag="requesting.tag"
      @close="requesting = null"
      @opened="onRequested"
    />
    <PromotePromptModal
      v-if="promoting"
      :prompt-id="promptId"
      :tag="promoting.tag"
      :version="promoting.version"
      :reason="reason"
      :can-bypass="access.canGovern.value"
      @close="promoting = null"
      @moved="onPromoted"
    />
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
.soft {
  color: var(--mt-muted);
  font-size: 12px;
  margin: 0;
}
.small {
  font-size: 12.5px;
  margin: 0;
}
.grow {
  flex: 1;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.eyebrow {
  font-family: var(--mt-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--mt-faint);
}

/* ---- selector de versión: un desplegable en la barra de arriba ---- */

/* ---- cabecera del prompt ---- */
.description {
  margin: 0;
  font-size: 13px;
  color: var(--mt-muted);
}
.archived {
  background: var(--mt-soft);
  color: var(--mt-muted);
}

/* ---- vistas de página completa ---- */
.used-pane h3.sub-title {
  margin: 4px 0 0;
  font-size: 14px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
}
.compare-bar,
.row,
.move {
  display: flex;
  align-items: center;
  gap: 8px;
}
.move {
  flex-wrap: wrap;
}
h3 {
  margin: 8px 0 0;
  font-size: 13px;
}

/* contenido */
.content-grid {
  display: block;
}
.code-card {
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--mt-card);
}
.code-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--mt-line);
  font-size: 13px;
}
.code-msg {
  font-weight: 700;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.from {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.code {
  margin: 0;
  padding: 10px 0;
  counter-reset: ln;
  font-family: var(--mt-mono);
  font-size: 12px;
  color: var(--mt-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.ln {
  display: block;
  counter-increment: ln;
  min-height: 26px;
  line-height: 26px;
  padding: 0 16px 0 52px;
  position: relative;
  text-indent: 0;
}
.ln::before {
  content: counter(ln);
  position: absolute;
  left: 14px;
  width: 22px;
  text-align: right;
  color: var(--mt-line);
  font-size: 11px;
  user-select: none;
}
.ln.heading {
  color: var(--mt-ink);
  font-weight: 800;
}
.ln.changed {
  background: var(--mt-accent-tint);
}
.ln.changed::after {
  content: "";
  position: absolute;
  left: 4px;
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 2px;
  background: var(--mt-brand);
}
.variable {
  padding: 0 2px;
  border-radius: 3px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-weight: 500;
}
.code-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--mt-line-2);
  font-size: 12px;
  color: var(--mt-faint);
}
.code-foot i {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--mt-brand);
}
.vars {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.var {
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-family: var(--mt-mono);
  font-size: 12px;
}
.editor-layout {
  display: block;
}
.editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dependents-banner {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 14px 18px;
  border-radius: 10px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.dependents-banner > div {
  flex: 1;
}
.dependents-banner p {
  margin: 4px 0 0;
  line-height: 1.5;
}
.ok-pill {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}

/* comparar */
.behaviour {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.compare-toolbar {
  flex-wrap: wrap;
}
.bar-select {
  flex: none;
  width: 120px;
}
.warn-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--mt-warn-ink) 18%, transparent);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
  font-weight: 500;
}
.warn-icon {
  flex: none;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 12px;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 2px;
}
.bar {
  height: 4px;
  border-radius: 2px;
  background: var(--mt-soft);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
}
.bar.base i {
  background: var(--mt-faint);
  opacity: 0.55;
}
.bar.target i {
  background: var(--mt-accent);
}
.bar.target.worse i {
  background: var(--mt-err);
}
.tile-value {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.tile-value strong {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.tile .mt-pill {
  align-self: flex-start;
}

/* evidencia */
.table-scroll {
  overflow-x: auto;
}
.evidence-card {
  border: 1px solid var(--mt-line);
  border-radius: 10px;
}
.evidence {
  border-collapse: collapse;
  font-size: 13px;
  min-width: 100%;
}
.evidence th {
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
.evidence td {
  padding: 9px 14px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
  vertical-align: middle;
}
.evidence tr:last-child td {
  border-bottom: none;
}
.num {
  text-align: right;
}
.env-stack {
  display: flex;
  gap: 4px;
  margin-top: 3px;
}
.cell-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.meter {
  display: block;
  width: 110px;
  height: 5px;
  border-radius: 3px;
  background: var(--mt-soft);
}
.meter span {
  display: block;
  height: 5px;
  border-radius: 3px;
  background: var(--mt-faint);
}
.meter.bad span {
  background: var(--mt-err);
}
.bad {
  color: var(--mt-err-ink);
}
.score {
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.low-sample {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.failures {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
}
.failure {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}
.failure-title {
  flex: none;
  width: 190px;
  font-weight: 700;
}
.failure-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: var(--mt-soft);
}
.failure-bar span {
  display: block;
  height: 8px;
  border-radius: 4px;
  background: var(--mt-highlight);
}

/* tags */
.tags-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.card {
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mt-line-2);
}
.card-head h3 {
  margin: 0;
  font-size: 14px;
}
.card-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.env-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--mt-line-2);
}
.env-badge {
  flex: none;
  width: 44px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-family: var(--mt-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
}
.env-badge b {
  font-weight: 500;
}
.env-badge.pre {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.env-badge.pro {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.env-ver {
  flex: none;
  font-size: 14px;
}
.env-msg {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.env-usage {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.move {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.move :deep(.select-trigger) {
  min-width: 96px;
}

.other-tags {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  background: var(--mt-accent-tint);
}
.other-tags p {
  margin: 0;
}
.other-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.other-help {
  line-height: 1.5;
}
.free-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
}
.free-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.grow {
  flex: 1;
}
.followers {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.followers li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--mt-accent-tint);
}
.no-followers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--mt-warn-bg);
  color: var(--mt-ink);
}
.snippet {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--mt-ink);
  color: var(--mt-card);
}
.snippet code {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
}
.snippet .copy {
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.tag-error {
  color: var(--mt-err-ink);
}
.add-tag {
  display: flex;
  align-items: center;
  gap: 8px;
}

ul.plain {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
}
.draft-pill {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.draft-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border: 1px dashed var(--mt-warn-ink);
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
  font-size: 13px;
}
.draft-banner p {
  margin: 4px 0 0;
}
.draft-actions {
  display: flex;
  gap: 8px;
}
.protected {
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
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
.warn {
  margin: 0;
  color: var(--mt-warn-ink);
}
.policy-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.runs {
  width: 64px;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
}
.free-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.free-tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 6px 0 10px;
  border-radius: 14px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  color: var(--mt-accent-text);
  font-size: 12px;
}
.free-tag .x {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: var(--mt-accent-soft);
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.usage-fold summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  padding: 8px 0;
}
.history .empty {
  margin: 0;
  padding: 12px 16px;
}
.events {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12.5px;
}
.events li {
  display: grid;
  grid-template-columns: 8px minmax(180px, 280px) 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--mt-line-2);
}
.events li:last-child {
  border-bottom: none;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mt-accent);
}
.dot.dev {
  background: var(--mt-muted);
}
.dot.pre {
  background: var(--mt-highlight);
}
.dot.free {
  background: var(--mt-accent-soft);
}
.ev-what b {
  font-weight: 600;
}
.ev-note {
  min-width: 0;
  color: var(--mt-muted);
}
.ev-date {
  color: var(--mt-faint);
  font-size: 11.5px;
  white-space: nowrap;
}
.usage-fold {
  padding: 4px 16px;
}
.policy-card .card-head {
  border-bottom: none;
  padding-bottom: 0;
}

@media (max-width: 1100px) {
  .body {
    flex-direction: column;
  }
  .inspector {
    width: auto;
    overflow: visible;
  }
  .tags-pane {
    grid-template-columns: 1fr;
  }
}

/* ---- cabecera: descripción, franja de entornos y pestañas ---- */
.env-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
}
.env-card.late {
  background: var(--mt-highlight-soft);
  border-color: var(--mt-highlight);
}
.env-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.env-card-ver {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.env-card-note {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-ok-ink);
}
.env-card-note.late {
  color: var(--mt-highlight-ink);
}

/* ---- propiedades del texto: variables, fragmentos que incluye, quién lo usa ---- */
.props {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 28px;
  padding: 12px 16px;
  border-top: 1px solid var(--mt-line);
  background: var(--mt-soft);
}
.prop {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.include {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
}


/* ---- dos columnas: entornos y versiones | versión elegida ---- */
.title-row {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
}
.title-row .description {
  margin: 0;
  font-size: 13px;
  color: var(--mt-muted);
}
.split {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 24px;
}
.side {
  width: 380px;
  flex: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.env-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.env-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
}
.env-card.late {
  background: var(--mt-highlight-soft);
  border-color: var(--mt-highlight);
}
.env-card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.env-card-ver {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.env-card-note {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-ok-ink);
}
.env-card-note.late {
  color: var(--mt-highlight-ink);
}
.versions-box {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
  overflow: hidden;
}
.detail {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}
.vhead {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.vnum {
  font-size: 20px;
  letter-spacing: -0.02em;
}
.vmsg {
  font-weight: 700;
}
.view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.test-switch {
  align-self: flex-start;
}
.code-head {
  justify-content: flex-end;
}
.code {
  font-size: 14px;
}
.ln {
  min-height: 30px;
  line-height: 30px;
}

/* ---- panel lateral: reglas, actividad y quién lo usa ---- */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(10, 35, 33, 0.25);
}
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 41;
  width: min(620px, 100vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 0;
  background: var(--mt-bg);
  border-left: 1px solid var(--mt-line);
  box-shadow: -12px 0 32px rgba(10, 35, 33, 0.16);
}
.drawer-fade-enter-active,
.drawer-fade-leave-active { transition: opacity 0.2s ease; }
.drawer-fade-enter-from,
.drawer-fade-leave-to { opacity: 0; }
/* solo entrada: al cerrar, el contenido ya no existe y deslizarlo vacío se vería roto */
.drawer-slide-enter-active { transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.drawer-slide-enter-from { transform: translateX(100%); }
@media (prefers-reduced-motion: reduce) {
  .drawer-fade-enter-active, .drawer-fade-leave-active,
  .drawer-slide-enter-active { transition: none; }
}
.drawer-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}
.drawer-resize:hover { background: var(--mt-accent-soft); }
.drawer-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
}
.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 20px;
}
</style>
