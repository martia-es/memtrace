<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { DeploymentSummaryDto, RepoConfigDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { GATE_LABEL } from "@/domain/assistants";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import TextInput from "@/ui/components/TextInput.vue";
import CommitLink from "../CommitLink.vue";
import Modal from "../Modal.vue";
import StatusChip from "../StatusChip.vue";
import Button from "../Button.vue";
import Checkbox from "../Checkbox.vue";

/**
 * Despliegue de un entorno (ADR-064). MemTrace no despliega: dispara el CI del repo con el commit al que apunta hoy la rama
 * del entorno, y solo si ese commit tiene una evaluación exitosa. Saltarse el gate exige permiso de gobernanza y un motivo.
 */
const props = defineProps<{ experimentId: string; deployment: DeploymentSummaryDto; repo: RepoConfigDto | null; canBypass: boolean }>();
const emit = defineEmits<{ close: []; deployed: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const preview = useAsync((signal) => api.previewDeploy(props.experimentId, props.deployment.id, signal));
onMounted(() => void preview.run());

const gate = computed(() => preview.data.value?.gate ?? null);
const verdict = computed(() => (gate.value ? (GATE_LABEL[gate.value.verdict] ?? { label: gate.value.verdict, tone: "neutral" as const }) : null));
const bypassing = ref(false);
const reason = ref("");
const sending = ref(false);
const fieldErrors = ref<Record<string, string>>({});

const canSend = computed(() => {
  if (!gate.value || sending.value) return false;
  return gate.value.allowed || (bypassing.value && reason.value.trim().length >= 5);
});

async function send() {
  sending.value = true;
  fieldErrors.value = {};
  try {
    await api.deploy(props.experimentId, props.deployment.id, gate.value?.allowed ? null : reason.value.trim());
    $q.notify({ message: `Deploy to ${props.deployment.environment.label} started. The CI will report how it ends.`, color: "positive", timeout: 4000 });
    emit("deployed");
    emit("close");
  } catch (error) {
    fieldErrors.value = (error as { fields?: Record<string, string> }).fields ?? {};
    $q.notify({ message: `Could not deploy: ${describeApiError(error as Error)}`, color: "negative", timeout: 5000 });
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Modal :title="`Deploy to ${deployment.environment.label}`" medium @close="emit('close')">
    <div class="deploy" data-testid="deploy-modal">
      <p v-if="preview.loading.value && !preview.data.value" class="muted">Checking what would be deployed…</p>
      <p v-else-if="preview.error.value" class="problem" role="alert" data-testid="deploy-error">{{ describeApiError(preview.error.value) }}</p>
      <template v-else-if="preview.data.value && gate">
        <dl class="facts">
          <dt>Branch</dt>
          <dd class="mono">{{ preview.data.value.ref }}</dd>
          <dt>Commit</dt>
          <dd><CommitLink :revision="preview.data.value.sha" :repo="repo" /></dd>
          <dt>Evaluation</dt>
          <dd><StatusChip :tone="verdict!.tone" :label="verdict!.label" data-testid="gate-verdict" /></dd>
        </dl>
        <p class="reason" data-testid="gate-reason">{{ gate.reason }}</p>
        <ul v-if="gate.runs.some((r) => r.failures.length)" class="failures">
          <template v-for="r in gate.runs" :key="r.runId">
            <li v-for="f in r.failures" :key="r.runId + f.evaluator">
              <template v-if="f.incomplete"><b>{{ f.evaluator }}</b> scored only {{ f.incomplete.scored }} of {{ f.incomplete.items }} items <span class="muted">(the rest failed to run, so its pass rate says nothing about the run)</span></template>
              <template v-else><b>{{ f.evaluator }}</b> {{ f.passRate === null ? "has no results" : `${Math.round(f.passRate * 100)}%` }} <span class="muted">(target {{ Math.round(f.target * 100) }}%)</span></template>
            </li>
          </template>
        </ul>

        <template v-if="!gate.allowed">
          <p class="hint">Run the offline evaluation from your CI on this commit, then come back. Evaluations run on a laptop with uncommitted changes do not count.</p>
          <Checkbox v-if="canBypass" class="bypass" v-model="bypassing" data-testid="bypass-toggle"> Deploy anyway (hotfix)</Checkbox>
          <label v-if="bypassing" class="field">
            <span>Why? It stays in the deployment history.</span>
            <TextInput v-model="reason" multiline :rows="2" :invalid="!!fieldErrors.bypassReason" data-testid="bypass-reason" />
            <span v-if="fieldErrors.bypassReason" class="field-error">{{ fieldErrors.bypassReason }}</span>
          </label>
        </template>
      </template>
      <div class="actions">
        <Button @click="emit('close')">Cancel</Button>
        <Button variant="primary" :disabled="!canSend" data-testid="deploy-confirm" @click="send">{{ sending ? "Starting…" : gate && !gate.allowed ? "Deploy anyway" : "Deploy" }}</Button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.deploy { display: flex; flex-direction: column; gap: 14px; min-width: min(560px, 80vw); }
.facts { display: grid; grid-template-columns: 100px 1fr; gap: 10px 12px; margin: 0; font-size: 14px; align-items: center; }
dt { color: var(--mt-muted); }
dd { margin: 0; }
.mono { font-family: var(--mt-mono); }
.muted { color: var(--mt-muted); font-size: 12px; }
.reason { margin: 0; font-size: 14px; line-height: 1.5; }
.failures { margin: 0; padding-left: 18px; font-size: 13px; }
.hint { margin: 0; font-size: 13px; color: var(--mt-muted); line-height: 1.5; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-error-text, var(--mt-ink)); background: var(--mt-error-soft, var(--mt-bg)); border-radius: var(--mt-radius-sm); }
.bypass { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; }
.field-error { color: var(--mt-error-text, #b3261e); font-weight: 500; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }

</style>
