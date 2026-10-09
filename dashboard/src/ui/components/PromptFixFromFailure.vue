<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PromptVersionDto, PromptUsageDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { FAILURE_REASONS, FAILURE_REASON_LABELS, baseVersionFor, defaultRationale, failureOf, type FailureReason } from "@/domain/prompt-fix";
import { formatDateTime } from "@/domain/format";
import { promptsUsedBy, replayInputOf } from "@/domain/prompt-playground";
import { resolveRange } from "@/domain/time-range";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import { useTraceApi } from "../composables/useTraceApi";
import TextInput from "./TextInput.vue";
import Button from "./Button.vue";

/**
 * Arreglar un prompt desde un fallo real (ADR-072): se ve qué falló en la traza, se parte de la versión que la produjo, se
 * escribe el cambio y se guarda como BORRADOR con el fallo como origen. Un borrador se prueba en el asistente real y lo
 * publica una persona; nada se promueve solo.
 */
const props = defineProps<{ experimentId: string; promptId: string; promptName: string; versions: PromptVersionDto[]; selected: number | null; usage: PromptUsageDto[]; initialTrace: string | null }>();
const emit = defineEmits<{ saved: [draft: number]; test: [draft: number, base: number, traceId: string] }>();

const api = usePromptApi();
const traces = useTraceApi();

const STEPS = ["See the failure", "Change the prompt", "Save and test"];
const traceId = ref(props.initialTrace ?? "");
const loadedTrace = ref<string | null>(null);
const problem = ref<string | null>(null);
const trace = useAsync((signal) => traces.getTrace(traceId.value.trim(), signal));

const failure = computed(() => (trace.data.value ? failureOf(trace.data.value.roots) : null));
const replay = computed(() => (trace.data.value ? replayInputOf(trace.data.value.roots) : { message: null, answer: null }));
const usedVersion = computed(() => promptsUsedBy(trace.data.value?.roots ?? []).find((p) => p.name === props.promptName)?.version ?? null);
const base = computed(() => baseVersionFor(props.versions, usedVersion.value, props.selected));

const content = ref("");
const rationale = ref("");
const saving = ref(false);
const savedDraft = ref<{ version: number; base: number } | null>(null);

const step = computed(() => (savedDraft.value ? 3 : loadedTrace.value ? 2 : 1));

// los fallos recientes de ESTE prompt, de cualquier origen, para elegir uno en vez de ir a buscar su id a otra pantalla
const PAGE = 10;
const reason = ref<FailureReason | "all">("all");
const shown = ref(PAGE);
const recent = useAsync((signal) => {
  const { from, to } = resolveRange("30d", Date.now());
  return api.getFailures(props.experimentId, props.promptId, { from: new Date(from), to: new Date(to) }, signal);
});
const all = computed(() => recent.data.value?.items ?? []);
const failures = computed(() => (reason.value === "all" ? all.value : all.value.filter((f) => f.reasons.includes(reason.value as FailureReason))));
const visible = computed(() => failures.value.slice(0, shown.value));
const counts = computed(() => recent.data.value?.counts ?? { error: 0, low_score: 0, human_low: 0, user_dislike: 0 });
const filters = computed(() => [{ key: "all" as const, label: "All", n: all.value.length }, ...FAILURE_REASONS.filter((r) => counts.value[r] > 0).map((r) => ({ key: r, label: FAILURE_REASON_LABELS[r], n: counts.value[r] }))]);
const picking = computed(() => !loadedTrace.value);
const pasteOpen = ref(false);
watch(reason, () => (shown.value = PAGE));
watch(() => props.promptId, () => void recent.run(), { immediate: true });

function pick(id: string) {
  traceId.value = id;
  void load();
}
function backToList() {
  loadedTrace.value = null;
  savedDraft.value = null;
  problem.value = null;
  void recent.run();
}

async function load() {
  const id = traceId.value.trim();
  if (id === "") return;
  problem.value = null;
  savedDraft.value = null;
  const found = await trace.run();
  if (!found) {
    problem.value = trace.error.value ? describeApiError(trace.error.value) : "Could not load that trace";
    return;
  }
  loadedTrace.value = id;
}

// al cargar la traza (o al cambiar la versión de partida) el editor arranca con el texto de esa versión y el motivo con el fallo
watch([loadedTrace, base], () => {
  content.value = base.value?.content ?? "";
  rationale.value = defaultRationale(failure.value);
}, { immediate: false });
onMounted(() => { if (props.initialTrace) void load(); });

const unchanged = computed(() => base.value !== null && content.value.trim() === base.value.content.trim());
const canSave = computed(() => !saving.value && loadedTrace.value !== null && base.value !== null && content.value.trim() !== "" && !unchanged.value);

async function save() {
  if (!base.value || !loadedTrace.value) return;
  saving.value = true;
  problem.value = null;
  try {
    const draft = await api.saveVersion(props.promptId, {
      content: content.value,
      message: "Proposed fix",
      parentVersion: base.value.version,
      draft: true,
      origin: { traceIds: [loadedTrace.value], cause: failure.value?.message ?? null, rationale: rationale.value },
    });
    savedDraft.value = { version: draft.version, base: base.value.version };
    emit("saved", draft.version);
  } catch (error) {
    problem.value = describeApiError(error as Error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fix" data-testid="fix">
    <div class="top">
      <ol class="steps" aria-label="Steps">
        <li v-for="(label, i) in STEPS" :key="label" :class="{ done: step > i + 1, now: step === i + 1 }">
          <span class="step-dot">{{ step > i + 1 ? "✓" : i + 1 }}</span>{{ label }}
        </li>
      </ol>
      <Button size="sm" v-if="loadedTrace" data-testid="fix-back" @click="backToList">← Pick another failure</Button>
    </div>
    <p v-if="problem" class="warn small" role="alert" data-testid="fix-problem">{{ problem }}</p>

    <section v-if="picking" class="panel picker" data-testid="fix-picker">
      <header>
        <b>Which failure do you want to fix?</b>
        <span class="faint">Last 30 days of {{ promptName }}: errors, low scores, reviewer "no" and 👎 from users</span>
      </header>
      <div v-if="recent.loading.value && !recent.data.value" class="center"><q-spinner size="24px" color="primary" /></div>
      <p v-else-if="recent.error.value" class="warn small pad" role="alert">{{ describeApiError(recent.error.value) }}</p>
      <p v-else-if="all.length === 0" class="muted small pad" data-testid="fix-picker-empty">
        No failure found among the latest {{ recent.data.value?.scanned ?? 0 }} traces of this prompt. Good news, or the agent is not sending traces yet. You can still paste a trace id below.
      </p>
      <template v-else>
        <div class="filters" role="group" aria-label="Reason">
          <button v-for="f in filters" :key="f.key" type="button" class="chip" :class="{ on: reason === f.key }" :data-testid="`fix-filter-${f.key}`" @click="reason = f.key">
            {{ f.label }} <b>{{ f.n }}</b>
          </button>
        </div>
        <ul class="cases">
          <li v-for="t in visible" :key="t.traceId">
            <button type="button" class="case" :disabled="trace.loading.value" data-testid="fix-case" @click="pick(t.traceId)">
              <span class="case-main">
                <span class="case-said">{{ t.input ?? "(no input captured)" }}</span>
                <span v-if="t.error" class="case-error">{{ t.error }}</span>
                <span v-else-if="t.output" class="case-answer">{{ t.output }}</span>
              </span>
              <span class="case-meta">
                <span v-for="r in t.reasons" :key="r" class="reason" :class="r" data-testid="fix-reason">{{ FAILURE_REASON_LABELS[r] }}</span>
                <span class="mono faint">{{ formatDateTime(t.startTime) }}</span>
              </span>
            </button>
          </li>
        </ul>
        <div class="more">
          <Button size="sm" v-if="failures.length > visible.length" data-testid="fix-more" @click="shown += PAGE">Show {{ Math.min(PAGE, failures.length - visible.length) }} more</Button>
          <span class="faint small" data-testid="fix-scanned">{{ failures.length }} {{ failures.length === 1 ? "failure" : "failures" }} among the latest {{ recent.data.value?.scanned }} traces of this prompt.</span>
        </div>
      </template>
      <footer class="paste">
        <Button class="self-start" variant="link" data-testid="fix-paste-toggle" @click="pasteOpen = !pasteOpen">Have a trace id? {{ pasteOpen ? "Hide" : "Paste it" }}</Button>
        <div v-if="pasteOpen" class="row">
          <TextInput v-model="traceId" mono placeholder="Trace id of the failure" class="trace-id" data-testid="fix-trace" @keydown.enter.prevent="load" />
          <Button size="sm" :disabled="trace.loading.value || traceId.trim() === ''" data-testid="fix-load" @click="load">Load</Button>
        </div>
      </footer>
    </section>

    <div v-if="loadedTrace && trace.data.value" class="grid">
      <section class="panel failure" data-testid="fix-failure">
        <div class="block bad">
          <span class="eyebrow bad-ink">WHAT FAILED</span>
          <template v-if="failure">
            <span class="step-chip mono">{{ failure.step }}</span>
            <p class="msg">{{ failure.message }}</p>
          </template>
          <p v-else class="muted small" data-testid="fix-no-failure">No step of this trace failed. A fix needs a failure; you can still propose a change, but there is nothing to check it against.</p>
        </div>
        <div v-if="replay.message" class="block">
          <span class="eyebrow">THE PERSON SAID</span>
          <p class="small">{{ replay.message }}</p>
        </div>
        <div v-if="replay.answer" class="block grow">
          <span class="eyebrow">THE AGENT ANSWERED</span>
          <p class="small muted">{{ replay.answer }}</p>
        </div>
        <footer class="used">
          <template v-if="usedVersion !== null"><span data-testid="fix-used">This trace used <b class="mono">v{{ usedVersion }}</b>{{ base && base.version !== usedVersion ? ` (not available as a base; starting from v${base.version})` : "" }}</span></template>
          <template v-else><span data-testid="fix-unknown-version">This trace does not say which version it used: starting from <b class="mono">v{{ base?.version }}</b>.</span></template>
        </footer>
      </section>

      <section v-if="base" class="panel editor">
        <header>
          <b>Prompt text</b><span class="faint">starting from v{{ base.version }}</span>
          <span v-if="!unchanged" class="mt-pill ok-pill" data-testid="fix-changed">changed</span>
        </header>
        <div class="body">
          <TextInput v-model="content" multiline :rows="12" mono data-testid="fix-content" />
          <label class="field">
            <span class="muted small strong">Why should this fix it?</span>
            <TextInput v-model="rationale" multiline :rows="2" data-testid="fix-rationale" />
          </label>
          <p v-if="unchanged" class="muted small" data-testid="fix-unchanged">Change the text to save a proposal.</p>
        </div>
        <footer class="save">
          <span class="muted small">Saved as a <b>draft</b>: no tag, not published. A person reviews it first.</span>
          <Button variant="primary" :disabled="!canSave" data-testid="fix-save" @click="save">{{ saving ? "Saving…" : "Save as draft" }}</Button>
        </footer>
      </section>
      <p v-else class="warn small" data-testid="fix-no-base">This prompt has no published version to start from.</p>
    </div>

    <section v-if="savedDraft && loadedTrace" class="panel saved" data-testid="fix-saved">
      <p><b>Draft v{{ savedDraft.version }} saved.</b> It has no tag and is not published.</p>
      <div class="row">
        <Button variant="primary" data-testid="fix-test" @click="emit('test', savedDraft.version, savedDraft.base, loadedTrace)">Test it on this case</Button>
        <span class="muted small">Runs the real agent with the draft and with v{{ savedDraft.base }}, side by side.</span>
      </div>
    </section>

    <p class="faint small tip" data-testid="fix-tip">
      Prefer a model to write the proposal? <code>memtrace.prompts.propose_fix(name, cases, llm)</code> uses <b>your</b> LLM, with your key, and saves the result here as a draft.
    </p>
  </div>
</template>

<style scoped>
.fix {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.muted {
  color: var(--mt-muted);
}
.small {
  margin: 0;
  font-size: 12.5px;
}
.warn {
  margin: 0;
  color: var(--mt-warn-ink);
}
.trace-id {
  flex: 1;
  min-width: 260px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.faint {
  color: var(--mt-faint);
}
.strong {
  font-weight: 700;
}
.top {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.steps {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-weight: 600;
  color: var(--mt-faint);
}
.steps li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.steps li + li::before {
  content: "";
  width: 28px;
  height: 2px;
  border-radius: 1px;
  background: var(--mt-line);
  margin-right: 2px;
}
.step-dot {
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--mt-line);
  border-radius: 50%;
  font-family: var(--mt-mono);
  font-size: 11px;
}
.steps li.now {
  color: var(--mt-ink);
  font-weight: 800;
}
.steps li.now .step-dot {
  border: 2px solid var(--mt-brand);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.steps li.done {
  color: var(--mt-muted);
}
.steps li.done .step-dot {
  border-color: var(--mt-accent);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.picker header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mt-line);
}
.center,
.pad {
  padding: 16px;
}
.center {
  display: flex;
  justify-content: center;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--mt-line-2);
}
.chip {
  padding: 3px 10px;
  border: 1px solid var(--mt-line);
  border-radius: 999px;
  background: transparent;
  color: var(--mt-muted);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.chip.on {
  border-color: var(--mt-brand);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.reason {
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--mt-soft-2);
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 600;
}
.reason.error {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.case-answer {
  color: var(--mt-muted);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.more {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
}
.cases {
  margin: 0;
  padding: 0;
  list-style: none;
}
.case {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-bottom: 1px solid var(--mt-line-2);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.case:hover,
.case:focus-visible {
  background: var(--mt-soft-2);
}
.case-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.case-said {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.case-error {
  color: var(--mt-highlight-ink);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.case-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  font-size: 12px;
}
.paste {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 16px;
  background: var(--mt-soft-2);
}

.grid {
  display: flex;
  gap: 14px;
  align-items: stretch;
}
.panel {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
  overflow: hidden;
}
.failure {
  width: 310px;
  flex: none;
}
.editor {
  flex: 1;
  min-width: 0;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mt-line-2);
}
.block.grow {
  flex: 1;
}
.block p {
  margin: 0;
  line-height: 1.45;
}
.msg {
  font-weight: 600;
}
.bad-ink {
  color: var(--mt-highlight-ink);
}
.step-chip {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-size: 12px;
}
.used {
  padding: 10px 16px;
  background: var(--mt-soft-2);
  border-top: 1px solid var(--mt-line-2);
  font-size: 12px;
  color: var(--mt-muted);
}
.editor header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--mt-line);
}
.editor .body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  flex: 1;
}
.ok-pill {
  margin-left: auto;
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.save {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--mt-soft-2);
  border-top: 1px solid var(--mt-line-2);
}
.save .muted {
  flex: 1;
}
.saved {
  gap: 8px;
  padding: 12px 16px;
  border-color: var(--mt-ok-ink);
}
.saved p {
  margin: 0;
}
.eyebrow {
  font-family: var(--mt-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--mt-faint);
}
.tip {
  margin-top: 2px;
}
@media (max-width: 1000px) {
  .grid {
    flex-direction: column;
  }
  .failure {
    width: auto;
  }
}

.self-start { align-self: flex-start; }
</style>
