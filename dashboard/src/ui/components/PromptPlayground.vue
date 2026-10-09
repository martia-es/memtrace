<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PromptPlaygroundResponse, PromptUsageDto, PromptVersionDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { agentReadsPrompt, playgroundTargets, replayInputOf } from "@/domain/prompt-playground";
import { formatDuration } from "@/domain/format";
import { useAssistantApi } from "../composables/useAssistantApi";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import { useTraceApi } from "../composables/useTraceApi";
import ErrorBanner from "./ErrorBanner.vue";
import Select from "./Select.vue";
import TextInput from "./TextInput.vue";

/**
 * Probar versiones de un prompt en el asistente real (ADR-071): se ejecuta el agente de verdad, con sus tools y su RAG, sin
 * mover ningún tag. Hasta dos versiones a la vez, una al lado de la otra; el mensaje puede venir de una traza real.
 */
const props = defineProps<{ experimentId: string; promptId: string; versions: PromptVersionDto[]; selected: number | null; usage: PromptUsageDto[]; initialTrace: string | null; initialFirst?: number | null; initialSecond?: number | null }>();

const assistants = useAssistantApi();
const traces = useTraceApi();
const api = usePromptApi();

const card = useAsync((signal) => assistants.getAssistant(props.experimentId, signal));
onMounted(() => void card.run());
const targets = computed(() => (card.data.value ? playgroundTargets(card.data.value) : null));
const deploymentOptions = computed(() => (targets.value?.usable ?? []).map((t) => ({ label: t.label, value: t.deployment.id })));
const deploymentId = ref<string | null>(null);
watch(targets, (t) => {
  if (deploymentId.value === null && t?.usable[0]) deploymentId.value = t.usable[0].deployment.id;
}, { immediate: true });
const environmentKey = computed(() => targets.value?.usable.find((t) => t.deployment.id === deploymentId.value)?.deployment.environment.key ?? null);
const reads = computed(() => (environmentKey.value ? agentReadsPrompt(props.usage, environmentKey.value) : true));

// ---- qué versiones
const versionOptions = computed(() => props.versions.map((v) => ({ label: `v${v.version}${v.message ? ` · ${v.message}` : ""}`, value: v.version })));
const first = ref<number | null>(props.initialFirst ?? props.selected);
const second = ref<number | null>(props.initialSecond ?? null);
watch(() => props.selected, (v) => { if (first.value === null) first.value = v; });
const secondOptions = computed(() => versionOptions.value.filter((o) => o.value !== first.value));

// ---- qué mensaje
const message = ref("");
const traceId = ref(props.initialTrace ?? "");
const original = ref<{ traceId: string; answer: string | null } | null>(null);
const loadingTrace = ref(false);
const traceProblem = ref<string | null>(null);
async function loadTrace() {
  const id = traceId.value.trim();
  if (id === "") return;
  loadingTrace.value = true;
  traceProblem.value = null;
  try {
    const found = replayInputOf((await traces.getTrace(id)).roots);
    if (found.message === null) {
      traceProblem.value = "That trace has no captured message. Turn on content capture (MEMTRACE_CAPTURE_CONTENT) in the agent, or type the message.";
      original.value = null;
      return;
    }
    message.value = found.message;
    original.value = { traceId: id, answer: found.answer };
  } catch (error) {
    traceProblem.value = describeApiError(error as Error);
  } finally {
    loadingTrace.value = false;
  }
}
onMounted(() => { if (props.initialTrace) void loadTrace(); });

// ---- ejecutar
interface Outcome { version: number; result: PromptPlaygroundResponse | null; error: string | null }
const outcomes = ref<Outcome[]>([]);
const running = ref(false);
const canRun = computed(() => !running.value && deploymentId.value !== null && first.value !== null && message.value.trim() !== "");

async function run() {
  const versions = [first.value, second.value].filter((v): v is number => v !== null);
  running.value = true;
  outcomes.value = [];
  try {
    // las dos versiones a la vez: cada una lleva su propio token, no se pisan
    outcomes.value = await Promise.all(
      versions.map(async (version): Promise<Outcome> => {
        try {
          return { version, result: await api.runPlayground(props.experimentId, props.promptId, { deploymentId: deploymentId.value!, version, message: message.value }), error: null };
        } catch (error) {
          return { version, result: null, error: describeApiError(error as Error) };
        }
      }),
    );
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <div class="playground" data-testid="playground">
    <ErrorBanner v-if="card.error.value" :error="card.error.value" @retry="card.run()" />
    <p v-else-if="card.loading.value && !card.data.value" class="muted">Loading the agent…</p>
    <p v-else-if="targets?.unavailable" class="warn" data-testid="playground-unavailable">{{ targets.unavailable }}</p>

    <template v-else-if="targets">
      <p class="muted small">
        Runs the real agent —with its tools and knowledge— using the version you choose for that one message. No tag moves and nothing is promoted.
        It is never run against production.
      </p>

      <div class="row">
        <span class="muted">Run in</span>
        <Select v-model="deploymentId" :options="deploymentOptions" data-testid="playground-deployment" />
        <span class="muted">version</span>
        <Select v-model="first" :options="versionOptions" data-testid="playground-first" />
        <span class="muted">compare with</span>
        <Select v-model="second" :options="secondOptions" placeholder="none" data-testid="playground-second" />
        <button v-if="second !== null" type="button" class="ghost-btn small" data-testid="playground-clear" @click="second = null">Clear</button>
      </div>

      <p v-if="!reads" class="warn small" data-testid="playground-not-reading">
        No agent has reported reading this prompt in {{ environmentKey }}. The playground only works if the agent reads it with <code>memtrace.prompts</code>
        and runs with <code>MEMTRACE_ALLOW_PROMPT_OVERRIDE=true</code> and the <code>PromptOverrideMiddleware</code>. You can still try: MemTrace tells you whether the agent applied it.
      </p>

      <div class="row">
        <TextInput v-model="traceId" mono placeholder="Load the message of a trace (trace id)" class="trace-id" data-testid="playground-trace" @keydown.enter.prevent="loadTrace" />
        <button type="button" class="ghost-btn small" :disabled="loadingTrace || traceId.trim() === ''" data-testid="playground-load" @click="loadTrace">Load</button>
      </div>
      <p v-if="traceProblem" class="warn small" data-testid="playground-trace-problem">{{ traceProblem }}</p>

      <TextInput v-model="message" multiline :rows="4" placeholder="What does the person say?" data-testid="playground-message" />
      <div class="row">
        <button type="button" class="primary-btn" :disabled="!canRun" data-testid="playground-run" @click="run">{{ running ? "Running…" : second !== null ? "Run both" : "Run" }}</button>
      </div>

      <section v-if="original?.answer" class="card original" data-testid="playground-original">
        <header><b>Original answer</b> <router-link :to="{ name: 'trace', params: { experimentId, traceId: original.traceId } }" class="link">open its trace</router-link></header>
        <pre>{{ original.answer }}</pre>
      </section>

      <div v-if="outcomes.length > 0 || running" class="results" :class="{ two: outcomes.length > 1 || second !== null }" data-testid="playground-results">
        <section v-for="o in outcomes" :key="o.version" class="card" :data-testid="`playground-result-${o.version}`">
          <header>
            <b class="mono">v{{ o.version }}</b>
            <span v-if="o.result" class="mt-pill" :class="o.result.applied ? 'ok' : 'bad'" :data-testid="`applied-${o.version}`">{{ o.result.applied ? "applied" : "NOT applied" }}</span>
            <span v-if="o.result" class="muted mono">{{ formatDuration(o.result.latencyMs) }}</span>
            <router-link v-if="o.result?.traceId" :to="{ name: 'trace', params: { experimentId, traceId: o.result.traceId } }" class="link">open trace</router-link>
          </header>
          <p v-if="o.error" class="warn small" :data-testid="`error-${o.version}`">{{ o.error }}</p>
          <template v-else-if="o.result">
            <p v-if="!o.result.applied" class="warn small" :data-testid="`not-applied-${o.version}`">
              The agent answered without asking for this version, so <b>this answer is not from v{{ o.version }}</b>. Check that it reads the prompt with
              <code>memtrace.prompts</code>, that <code>MEMTRACE_ALLOW_PROMPT_OVERRIDE=true</code> and that the <code>PromptOverrideMiddleware</code> is installed.
            </p>
            <pre>{{ o.result.reply }}</pre>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.playground {
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
.results {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}
.results.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.card {
  padding: 10px 12px;
  border: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
}
.card header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12.5px;
}
.card pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
}
.original {
  background: var(--mt-card);
}
.link {
  margin-left: auto;
  color: var(--mt-accent-text);
  font-size: 12px;
}
.mt-pill.ok {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.mt-pill.bad {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
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
@media (max-width: 900px) {
  .results.two {
    grid-template-columns: 1fr;
  }
}
</style>
