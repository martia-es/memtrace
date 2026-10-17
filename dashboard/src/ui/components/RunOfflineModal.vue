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
import { t, tp } from "../i18n";

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
  $q.notify({ message: t("runOfflineModal.copied"), timeout: 1200, position: "bottom" });
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
  <Modal :title="t('runOfflineModal.run_offline')" full @close="emit('close')">
    <p class="intro muted">{{ t("runOfflineModal.pick_what_to_evaluate_you_get") + " " }}<code>.env</code>{{ " " + t("runOfflineModal.ready_to_run_on_your_machine") }}</p>
    <div class="layout">
      <div class="options">
        <section>
          <h3>{{ t("runOfflineModal.1_dataset") }}</h3>
          <div class="dataset-row">
            <span class="dataset-name">{{ datasetName }}</span>
            <Select v-model="version" :options="versionOptions" data-testid="run-version" />
          </div>
          <p class="hint muted"><template v-if="itemCount !== null">{{ t('runOfflineModal.count_items', { count: itemCount }) }} · </template>{{ t('runOfflineModal.pinning_a_version_makes_the_run') }}</p>
        </section>

        <section>
          <h3>{{ t("runOfflineModal.2_metrics") }}</h3>
          <div class="metric-group">
            <div class="group-title">{{ t("runOfflineModal.rules") + " " }}<span class="muted">{{ t("runOfflineModal.no_api_key") }}</span></div>
            <label v-for="m in EVAL_METRICS.filter((x) => x.group === 'rules')" :key="m.id" class="metric">
              <Checkbox v-model="metrics" :value="m.id" :data-testid="`metric-${m.id}`" />
              <b>{{ m.label }}</b><span class="muted">{{ m.description }}</span>
            </label>
          </div>
          <div class="metric-group">
            <div class="group-title">{{ t("runOfflineModal.llm_judge") + " " }}<span class="muted">{{ t("runOfflineModal.needs_anthropic_api_key") }}</span></div>
            <label v-for="m in EVAL_METRICS.filter((x) => x.group === 'judge')" :key="m.id" class="metric">
              <Checkbox v-model="metrics" :value="m.id" :data-testid="`metric-${m.id}`" />
              <b>{{ m.label }}</b><span class="muted">{{ m.description }}</span>
            </label>
          </div>
          <details class="unavailable">
            <summary>{{ t("runOfflineModal.not_available_from_here") }}</summary>
            <p v-for="u in EVAL_METRICS_UNAVAILABLE" :key="u.label" class="hint muted"><b>{{ u.label }}</b>: {{ u.reason }}.</p>
          </details>
        </section>

        <section>
          <h3>{{ t("runOfflineModal.3_agent_to_call") }}</h3>
          <template v-if="agent">
            <SegmentedControl
              :options="deployments.map((d) => ({ value: d.environment.key, label: d.environment.label }))"
              :model-value="environment?.environment.key"
              :aria-label="t('runOfflineModal.environment')"
              @update:model-value="environmentKey = $event as string"
            />
            <code class="url" data-testid="agent-url">POST {{ agent.url }}</code>
            <p class="hint muted">{{ t("runOfflineModal.host_of_the_environment_plus_the") }}</p>
          </template>
          <p v-else-if="cardLoading" class="hint muted">{{ t("runOfflineModal.reading_the_agent_card") }}</p>
          <p v-else class="hint muted" data-testid="no-agent">{{ t("runOfflineModal.this_agent_has_no_chat_endpoint") + " " }}<code>agent()</code>{{ " " + t("runOfflineModal.function_for_you_to_fill_in") }}</p>
        </section>
      </div>

      <div class="output">
        <TabBar :tabs="FILES.map((f) => ({ id: f.id, label: f.label }))" :model-value="activeFile" @update:model-value="activeFile = $event">
        </TabBar>
        <div class="output-actions">
          <Button size="sm" variant="secondary" data-testid="copy" @click="copy">{{ t("runOfflineModal.copy") }}</Button>
          <Button size="sm" variant="secondary" data-testid="download-current" @click="downloadCurrent">{{ t("runOfflineModal.download") }}</Button>
        </div>
        <CodeBlock class="code" :code="shown" :lang="current.lang" data-testid="code" />
        <p class="secrets" role="note" data-testid="secrets">
          {{ t("runOfflineModal.secrets_are_never_shown_here_fill") + " " }}<code v-for="s in secrets" :key="s">{{ s }}</code>{{ " " + t("runOfflineModal.in_the") + " " }}<code>.env</code>{{ t("runOfflineModal.the_memtrace_key_is_created_in") }}
        </p>
      </div>
    </div>

    <template #footer>
      <span class="muted summary">{{ tp("runOfflineModal.metrics", metrics.length) }}<template v-if="needsJudge(metrics)"> {{ t('runOfflineModal.1_needs_an_llm_judge_key') }}</template> · {{ t('runOfflineModal.results_upload_to_datasets_name_runs', { name: datasetName }) }}</span>
      <Button variant="secondary" @click="emit('close')">{{ t("runOfflineModal.close") }}</Button>
      <Button variant="primary" :disabled="!canGenerate" data-testid="download-both" @click="downloadBoth">{{ t("runOfflineModal.download_env_script") }}</Button>
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
