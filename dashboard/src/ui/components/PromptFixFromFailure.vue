<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PromptVersionDto, PromptUsageDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { baseVersionFor, defaultRationale, failureOf } from "@/domain/prompt-fix";
import { promptsUsedBy, replayInputOf } from "@/domain/prompt-playground";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import { useTraceApi } from "../composables/useTraceApi";
import TextInput from "./TextInput.vue";

/**
 * Arreglar un prompt desde un fallo real (ADR-072): se ve qué falló en la traza, se parte de la versión que la produjo, se
 * escribe el cambio y se guarda como BORRADOR con el fallo como origen. Un borrador se prueba en el asistente real y lo
 * publica una persona; nada se promueve solo.
 */
const props = defineProps<{ experimentId: string; promptId: string; promptName: string; versions: PromptVersionDto[]; selected: number | null; usage: PromptUsageDto[]; initialTrace: string | null }>();
const emit = defineEmits<{ saved: [draft: number]; test: [draft: number, base: number, traceId: string] }>();

const api = usePromptApi();
const traces = useTraceApi();

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
    <p class="muted small">
      Start from a real failure: see what broke, change the prompt and save it as a <b>draft</b>. A draft can be tested in the real agent and evaluated, but it gets no tag and
      nothing publishes it by itself: a person reviews it first.
    </p>

    <div class="row">
      <TextInput v-model="traceId" mono placeholder="Trace id of the failure" class="trace-id" data-testid="fix-trace" @keydown.enter.prevent="load" />
      <button type="button" class="ghost-btn small" :disabled="trace.loading.value || traceId.trim() === ''" data-testid="fix-load" @click="load">Load</button>
    </div>
    <p v-if="problem" class="warn small" role="alert" data-testid="fix-problem">{{ problem }}</p>

    <template v-if="loadedTrace && trace.data.value">
      <section class="card" data-testid="fix-failure">
        <span class="eyebrow">WHAT FAILED</span>
        <template v-if="failure">
          <p><b class="mono">{{ failure.step }}</b> — {{ failure.message }}</p>
        </template>
        <p v-else class="muted small" data-testid="fix-no-failure">No step of this trace failed. A fix needs a failure; you can still propose a change, but there is nothing to check it against.</p>
        <p v-if="replay.message" class="small"><span class="muted">The person said:</span> {{ replay.message }}</p>
        <p v-if="replay.answer" class="small"><span class="muted">The agent answered:</span> {{ replay.answer }}</p>
        <p v-if="usedVersion !== null" class="small muted" data-testid="fix-used">This trace used v{{ usedVersion }}{{ base && base.version !== usedVersion ? ` (not available as a base; starting from v${base.version})` : "" }}.</p>
        <p v-else class="small muted" data-testid="fix-unknown-version">This trace does not say which version of this prompt it used: starting from v{{ base?.version }}.</p>
      </section>

      <template v-if="base">
        <label class="field">
          <span class="muted small">Prompt text, starting from v{{ base.version }}</span>
          <TextInput v-model="content" multiline :rows="14" mono data-testid="fix-content" />
        </label>
        <label class="field">
          <span class="muted small">Why should this fix it?</span>
          <TextInput v-model="rationale" multiline :rows="2" data-testid="fix-rationale" />
        </label>
        <p v-if="unchanged" class="muted small" data-testid="fix-unchanged">Change the text to save a proposal.</p>
        <div class="row">
          <button type="button" class="primary-btn" :disabled="!canSave" data-testid="fix-save" @click="save">{{ saving ? "Saving…" : "Save as draft" }}</button>
        </div>
      </template>
      <p v-else class="warn small" data-testid="fix-no-base">This prompt has no published version to start from.</p>

      <section v-if="savedDraft" class="card ok" data-testid="fix-saved">
        <p><b>Draft v{{ savedDraft.version }} saved.</b> It has no tag and is not published.</p>
        <div class="row">
          <button type="button" class="primary-btn" data-testid="fix-test" @click="emit('test', savedDraft.version, savedDraft.base, loadedTrace)">Test it on this case</button>
          <span class="muted small">Runs the real agent with the draft and with v{{ savedDraft.base }}, side by side.</span>
        </div>
      </section>
    </template>

    <p class="muted small tip" data-testid="fix-tip">
      Prefer a model to write the proposal? <code>memtrace.prompts.propose_fix(name, cases, llm)</code> asks <b>your</b> LLM, with your key, and saves the result here as a draft.
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
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
}
.card p {
  margin: 0;
}
.card.ok {
  border-color: var(--mt-ok-ink);
}
.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mt-muted);
}
.tip {
  margin-top: 6px;
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
</style>
