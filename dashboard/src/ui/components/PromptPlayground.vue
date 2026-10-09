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
import Button from "./Button.vue";

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
// mensajes anteriores de la persona: el agente los recibe de nuevo, en la misma sesión, antes del mensaje que se prueba (ADR-075)
const history = ref<string[]>([]);
const MAX_HISTORY = 10;
function removeEarlier(index: number) { history.value = history.value.filter((_, i) => i !== index); }
const loadingTrace = ref(false);
const traceProblem = ref<string | null>(null);
async function loadTrace() {
  const id = traceId.value.trim();
  if (id === "") return;
  loadingTrace.value = true;
  traceProblem.value = null;
  try {
    const detail = await traces.getTrace(id);
    const found = replayInputOf(detail.roots);
    if (found.message === null) {
      traceProblem.value = "That trace has no captured message. Turn on content capture (MEMTRACE_CAPTURE_CONTENT) in the agent, or type the message.";
      original.value = null;
      return;
    }
    message.value = found.message;
    original.value = { traceId: id, answer: found.answer };
    history.value = await earlierMessages(detail.conversationId, id);
  } catch (error) {
    traceProblem.value = describeApiError(error as Error);
  } finally {
    loadingTrace.value = false;
  }
}
/** Los mensajes de la persona en los turnos anteriores de la misma conversación; vacío si no hay conversación o no se captura contenido. */
async function earlierMessages(conversationId: string | null, traceId: string): Promise<string[]> {
  if (!conversationId) return [];
  try {
    const turns = (await traces.getTranscript(conversationId)).turns;
    const at = turns.findIndex((t) => t.traceId === traceId);
    if (at <= 0) return [];
    return turns.slice(0, at).map((t) => t.user?.trim() ?? "").filter((m) => m !== "").slice(-MAX_HISTORY);
  } catch {
    return [];
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
  const earlier = history.value.map((m) => m.trim()).filter((m) => m !== "");
  running.value = true;
  outcomes.value = [];
  try {
    // las dos versiones a la vez: cada una lleva su propio token, no se pisan
    outcomes.value = await Promise.all(
      versions.map(async (version): Promise<Outcome> => {
        try {
          return { version, result: await api.runPlayground(props.experimentId, props.promptId, { deploymentId: deploymentId.value!, version, message: message.value, ...(earlier.length > 0 ? { history: earlier } : {}) }), error: null };
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
      <div class="pick">
        <b>Test</b>
        <Select v-model="first" :options="versionOptions" data-testid="playground-first" />
        <b>against</b>
        <Select v-model="second" :options="secondOptions" placeholder="nothing" data-testid="playground-second" />
        <Button size="sm" v-if="second !== null" data-testid="playground-clear" @click="second = null">Clear</Button>
        <template v-if="deploymentOptions.length > 1">
          <span class="muted">in</span>
          <Select v-model="deploymentId" :options="deploymentOptions" data-testid="playground-deployment" />
        </template>
        <span v-else-if="deploymentOptions[0]" class="tag mono" data-testid="playground-deployment-label">{{ deploymentOptions[0].label }}</span>
        <span class="grow" />
        <span class="faint small">Runs the real agent. Nothing is promoted.</span>
      </div>

      <p v-if="!reads" class="warn small" data-testid="playground-not-reading">
        No agent has reported reading this prompt in {{ environmentKey }}. The playground only works if the agent reads it with <code>memtrace.prompts</code>
        and runs with <code>MEMTRACE_ALLOW_PROMPT_OVERRIDE=true</code> and the <code>PromptOverrideMiddleware</code>. You can still try: MemTrace tells you whether the agent applied it.
      </p>

      <section class="panel">
        <header>
          <b>Message</b>
          <span v-if="original" class="tag mono">from {{ original.traceId }}</span>
          <span v-else class="faint small">What does the person say?</span>
        </header>
        <div class="earlier" data-testid="playground-history">
          <div v-for="(_, i) in history" :key="i" class="turn">
            <span class="who mono">PERSON</span>
            <TextInput v-model="history[i]" size="sm" :data-testid="`playground-earlier-${i}`" />
            <button type="button" class="x" :aria-label="`Remove earlier message ${i + 1}`" :data-testid="`playground-earlier-remove-${i}`" @click="removeEarlier(i)">×</button>
          </div>
          <p class="faint small note">
            <template v-if="history.length > 0">The agent receives these first, in the same conversation, and answers them again before the message below.</template>
            <template v-else>No earlier messages.</template>
            <button v-if="history.length < MAX_HISTORY" type="button" class="add" data-testid="playground-add-earlier" @click="history.push('')">+ Add an earlier message</button>
          </p>
        </div>
        <div class="body">
          <TextInput v-model="message" multiline :rows="3" placeholder="What does the person say?" data-testid="playground-message" />
          <p v-if="traceProblem" class="warn small" data-testid="playground-trace-problem">{{ traceProblem }}</p>
        </div>
        <footer>
          <TextInput v-model="traceId" mono size="sm" placeholder="or load it from a trace id" class="trace-id" data-testid="playground-trace" @keydown.enter.prevent="loadTrace" />
          <Button size="sm" :disabled="loadingTrace || traceId.trim() === ''" data-testid="playground-load" @click="loadTrace">Load</Button>
          <span class="grow" />
          <Button variant="primary" :disabled="!canRun" data-testid="playground-run" @click="run">{{ running ? "Running…" : "Run" }}</Button>
        </footer>
      </section>

      <div v-if="original?.answer || outcomes.length > 0 || running" class="results" data-testid="playground-results">
        <section v-if="original?.answer" class="panel before" data-testid="playground-original">
          <header><b class="muted">Before</b><router-link :to="{ name: 'trace', params: { experimentId, traceId: original.traceId } }" class="link">open its trace</router-link></header>
          <pre>{{ original.answer }}</pre>
        </section>
        <section v-for="o in outcomes" :key="o.version" class="panel" :data-testid="`playground-result-${o.version}`">
          <header>
            <b class="mono">v{{ o.version }}</b>
            <span v-if="o.result && !o.result.applied" class="mt-pill bad" :data-testid="`applied-${o.version}`">NOT applied</span>
            <span v-if="o.result" class="faint mono small">{{ formatDuration(o.result.latencyMs) }}</span>
            <router-link v-if="o.result?.traceId" :to="{ name: 'trace', params: { experimentId, traceId: o.result.traceId } }" class="link">open trace</router-link>
          </header>
          <p v-if="o.error" class="warn small pad" :data-testid="`error-${o.version}`">{{ o.error }}</p>
          <template v-else-if="o.result">
            <p v-if="!o.result.applied" class="warn small pad" :data-testid="`not-applied-${o.version}`">
              The agent answered without asking for this version, so <b>this answer is not from v{{ o.version }}</b>. Check that it reads the prompt with
              <code>memtrace.prompts</code>, that <code>MEMTRACE_ALLOW_PROMPT_OVERRIDE=true</code> and that the <code>PromptOverrideMiddleware</code> is installed.
            </p>
            <pre>{{ o.result.reply }}</pre>
          </template>
          <p v-else class="faint small pad">Running…</p>
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
.faint {
  color: var(--mt-faint);
}
.grow {
  flex: 1;
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
.pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
  overflow: hidden;
}
.panel > header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid var(--mt-line);
  font-size: 13px;
}
.panel > .body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
}
.panel > footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--mt-soft-2);
  border-top: 1px solid var(--mt-line-2);
}
.earlier {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 16px 0;
}
.turn {
  display: flex;
  align-items: center;
  gap: 10px;
}
.turn > :nth-child(2) {
  flex: 1;
}
.who {
  flex: none;
  width: 62px;
  padding: 2px 0;
  text-align: center;
  border-radius: 4px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.x {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--mt-faint);
  font: inherit;
  cursor: pointer;
}
.note {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0;
}
.add {
  border: none;
  background: transparent;
  color: var(--mt-accent-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.tag {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
}
.trace-id {
  width: 260px;
}
.results {
  display: flex;
  gap: 14px;
  align-items: stretch;
}
.results > .panel {
  flex: 1;
}
.results > .before {
  flex: none;
  width: 260px;
  border-style: dashed;
  border-color: var(--mt-faint);
  background: transparent;
}
.panel pre {
  margin: 0;
  padding: 16px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.6;
}
.before pre {
  color: var(--mt-muted);
}
.pad {
  padding: 12px 16px 0;
}
.link {
  margin-left: auto;
  color: var(--mt-accent-text);
  font-size: 12px;
  font-weight: 700;
}
.mt-pill.bad {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}

@media (max-width: 900px) {
  .results {
    flex-direction: column;
  }
  .results > .before {
    width: auto;
  }
}
</style>
