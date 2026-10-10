<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { AssistantCardDto, DatasetVersionDto } from "@contract";
import { ASSISTANT_API } from "@/dependency-container";
import {
  EVAL_METRICS,
  EVAL_METRICS_UNAVAILABLE,
  buildEvalEnv,
  buildEvalInstall,
  buildEvalScript,
  needsJudge,
  pendingSecrets,
  type EvalAgentTarget,
  type EvalMetricId,
} from "@/domain/eval-script";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";
import CodeBlock from "./CodeBlock.vue";
import Modal from "./Modal.vue";
import SegmentedControl from "./SegmentedControl.vue";
import Select from "./Select.vue";
import TabBar from "./TabBar.vue";

const props = defineProps<{ experimentId: string; datasetId: string; datasetName: string; versions: DatasetVersionDto[] }>();
const emit = defineEmits<{ close: [] }>();
const $q = useQuasar();

// la ficha del agente es opcional: sin permiso para leerla (o sin chat declarado) el script lleva una función para rellenar
const assistantApi = inject(ASSISTANT_API, null);
const card = ref<AssistantCardDto | null>(null);
const cardLoading = ref(Boolean(assistantApi));
onMounted(async () => {
  try {
    card.value = (await assistantApi?.getAssistant(props.experimentId)) ?? null;
  } catch {
    card.value = null;
  } finally {
    cardLoading.value = false;
  }
});

// ---- 1. dataset y versión (la última por defecto; fijar una hace el run reproducible) ----
const LATEST = "latest";
const version = ref<string>(LATEST);
const versionOptions = computed(() => [
  { value: LATEST, label: props.versions[0] ? `${props.versions[0].major}.${props.versions[0].minor} · latest` : "latest" },
  ...props.versions.slice(1).map((v) => ({ value: `${v.major}.${v.minor}`, label: `${v.major}.${v.minor}` })),
]);
const itemCount = computed(() => {
  const picked = version.value === LATEST ? props.versions[0] : props.versions.find((v) => `${v.major}.${v.minor}` === version.value);
  return picked?.itemCount ?? null;
});

// ---- 2. métricas ----
const metrics = ref<EvalMetricId[]>(["exact_match"]);

// ---- 3. agente: el host sale del despliegue y el path del agente (ADR-055) ----
const deployments = computed(() => [...(card.value?.deployments ?? [])].sort((a, b) => a.environment.position - b.environment.position));
const environmentKey = ref<string | null>(null);
const environment = computed(() => deployments.value.find((d) => d.environment.key === environmentKey.value) ?? deployments.value[0] ?? null);
const agent = computed<EvalAgentTarget | null>(() => {
  const chat = card.value?.chat;
  const deployment = environment.value;
  if (!chat || !deployment) return null;
  return {
    environment: deployment.environment.label,
    url: `${deployment.apiUrl.replace(/\/+$/, "")}${chat.path}`,
    requestField: chat.requestField,
    responseField: chat.responseField,
    needsAuth: deployment.authMethod !== "none",
  };
});

const input = computed(() => ({
  origin: window.location.origin,
  experimentId: props.experimentId,
  serviceName: card.value?.serviceName ?? "my-agent",
  datasetId: props.datasetId,
  datasetName: props.datasetName,
  version: version.value === LATEST ? null : version.value,
  metrics: metrics.value,
  agent: agent.value,
}));

// ---- salida ----
const FILES = [
  { id: "script", label: "run_eval.py", filename: "run_eval.py", lang: "python" as const, text: () => buildEvalScript(input.value) },
  { id: "env", label: ".env", filename: ".env", lang: "env" as const, text: () => buildEvalEnv(input.value) },
  { id: "install", label: "install", filename: "install.sh", lang: "shell" as const, text: () => buildEvalInstall(input.value) },
];
const activeFile = ref("script");
const current = computed(() => FILES.find((f) => f.id === activeFile.value) ?? FILES[0]!);
const shown = computed(() => current.value.text());
const secrets = computed(() => pendingSecrets(input.value));
const canGenerate = computed(() => metrics.value.length > 0);

function copy() {
  void navigator.clipboard.writeText(shown.value);
  $q.notify({ message: "Copied", timeout: 1200, position: "bottom" });
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
const downloadCurrent = () => download(current.value.filename, shown.value);
function downloadBoth() {
  for (const f of FILES.slice(0, 2)) download(f.filename, f.text());
}
</script>

<template>
  <Modal title="Run offline" full @close="emit('close')">
    <p class="intro muted">Pick what to evaluate. You get a script and a <code>.env</code> ready to run on your machine or in CI; the results land in this dataset's Runs.</p>
    <div class="layout">
      <div class="options">
        <section>
          <h3>1 · Dataset</h3>
          <div class="dataset-row">
            <span class="dataset-name">{{ datasetName }}</span>
            <Select v-model="version" :options="versionOptions" data-testid="run-version" />
          </div>
          <p class="hint muted"><template v-if="itemCount !== null">{{ itemCount }} items · </template>pinning a version makes the run reproducible after the dataset changes.</p>
        </section>

        <section>
          <h3>2 · Metrics</h3>
          <div class="metric-group">
            <div class="group-title">Rules <span class="muted">no API key</span></div>
            <label v-for="m in EVAL_METRICS.filter((x) => x.group === 'rules')" :key="m.id" class="metric">
              <Checkbox v-model="metrics" :value="m.id" :data-testid="`metric-${m.id}`" />
              <b>{{ m.label }}</b><span class="muted">{{ m.description }}</span>
            </label>
          </div>
          <div class="metric-group">
            <div class="group-title">LLM judge <span class="muted">needs ANTHROPIC_API_KEY</span></div>
            <label v-for="m in EVAL_METRICS.filter((x) => x.group === 'judge')" :key="m.id" class="metric">
              <Checkbox v-model="metrics" :value="m.id" :data-testid="`metric-${m.id}`" />
              <b>{{ m.label }}</b><span class="muted">{{ m.description }}</span>
            </label>
          </div>
          <details class="unavailable">
            <summary>Not available from here</summary>
            <p v-for="u in EVAL_METRICS_UNAVAILABLE" :key="u.label" class="hint muted"><b>{{ u.label }}</b>: {{ u.reason }}.</p>
          </details>
        </section>

        <section>
          <h3>3 · Agent to call</h3>
          <template v-if="agent">
            <SegmentedControl
              :options="deployments.map((d) => ({ value: d.environment.key, label: d.environment.label }))"
              :model-value="environment?.environment.key"
              aria-label="Environment"
              @update:model-value="environmentKey = $event as string"
            />
            <code class="url" data-testid="agent-url">POST {{ agent.url }}</code>
            <p class="hint muted">Host of the environment plus the agent's chat path and JSON contract (Assistants › agent card).</p>
          </template>
          <p v-else-if="cardLoading" class="hint muted">Reading the agent card…</p>
          <p v-else class="hint muted" data-testid="no-agent">This agent has no chat endpoint declared (or no environment), so the script leaves an <code>agent()</code> function for you to fill in.</p>
        </section>
      </div>

      <div class="output">
        <TabBar :tabs="FILES.map((f) => ({ id: f.id, label: f.label }))" :model-value="activeFile" @update:model-value="activeFile = $event">
        </TabBar>
        <div class="output-actions">
          <Button size="sm" variant="secondary" data-testid="copy" @click="copy">Copy</Button>
          <Button size="sm" variant="secondary" data-testid="download-current" @click="downloadCurrent">Download</Button>
        </div>
        <CodeBlock class="code" :code="shown" :lang="current.lang" data-testid="code" />
        <p class="secrets" role="note" data-testid="secrets">
          Secrets are never shown here. Fill in <code v-for="s in secrets" :key="s">{{ s }}</code> in the <code>.env</code>; the MemTrace key is created in Experiment › API keys.
        </p>
      </div>
    </div>

    <template #footer>
      <span class="muted summary">{{ metrics.length }} metric{{ metrics.length === 1 ? "" : "s" }}<template v-if="needsJudge(metrics)"> · 1 needs an LLM judge key</template> · results upload to Datasets › {{ datasetName }} › Runs</span>
      <Button variant="secondary" @click="emit('close')">Close</Button>
      <Button variant="primary" :disabled="!canGenerate" data-testid="download-both" @click="downloadBoth">Download .env + script</Button>
    </template>
  </Modal>
</template>

<style scoped>
.intro { margin: 0 0 12px; font-size: 13px; }
.layout { display: grid; grid-template-columns: 400px minmax(0, 1fr); gap: 20px; flex: 1; min-height: 0; }
.options { display: flex; flex-direction: column; gap: 18px; overflow: auto; padding-right: 4px; }
.options h3 { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; color: var(--mt-muted); }
.dataset-row { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 8px; align-items: center; }
.dataset-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { margin: 6px 0 0; font-size: 12px; }
.metric-group { border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); margin-bottom: 8px; overflow: hidden; }
.group-title { display: flex; justify-content: space-between; padding: 5px 10px; background: var(--mt-soft); font-size: 12px; font-weight: 800; color: var(--mt-muted); }
.group-title .muted { font-weight: 400; }
.metric { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-top: 1px solid var(--mt-line-2); cursor: pointer; font-size: 13px; }
.metric .muted { font-size: 12px; }
.unavailable { font-size: 12px; color: var(--mt-muted); }
.unavailable summary { cursor: pointer; font-weight: 700; }
.url { display: block; margin-top: 8px; padding: 6px 8px; background: var(--mt-soft); border-radius: var(--mt-radius-xs); font-size: 12px; word-break: break-all; }
.output { min-width: 0; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); overflow: hidden; background: var(--mt-bg); position: relative; }
.output-actions { position: absolute; top: 6px; right: 10px; display: flex; gap: 8px; }
.code { flex: 1; min-height: 0; padding: 14px 18px; }
.secrets { margin: 0; padding: 9px 14px; border-top: 1px solid var(--mt-line); background: var(--mt-warn-bg); color: var(--mt-warn-ink); font-size: 12px; font-weight: 600; }
.secrets code { margin-right: 6px; }
.summary { margin-right: auto; font-size: 12px; }
</style>
