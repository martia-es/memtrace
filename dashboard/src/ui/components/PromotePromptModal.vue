<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import { describeApiError } from "@/application/describe-api-error";
import { PROMPT_GATE_LABEL } from "@/domain/assistants";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import Modal from "./Modal.vue";
import StatusChip from "./StatusChip.vue";
import TextInput from "./TextInput.vue";

/**
 * Promoción de una versión a un entorno protegido (ADR-070). Antes de mover el tag dice si hay una evaluación exitosa de
 * esa versión y, si no, por qué. Saltarse el gate exige permiso de gobernanza y un motivo, que queda en el historial.
 */
const props = defineProps<{ promptId: string; tag: string; version: number; reason: string; canBypass: boolean }>();
const emit = defineEmits<{ close: []; moved: [] }>();

const api = usePromptApi();
const $q = useQuasar();
const preview = useAsync((signal) => api.previewGate(props.promptId, props.tag, props.version, signal));
onMounted(() => void preview.run());

const gate = computed(() => preview.data.value ?? null);
const verdict = computed(() => (gate.value ? (PROMPT_GATE_LABEL[gate.value.verdict] ?? { label: gate.value.verdict, tone: "neutral" as const }) : null));
const bypassing = ref(false);
const bypassReason = ref("");
const sending = ref(false);
const fieldErrors = ref<Record<string, string>>({});

const canSend = computed(() => {
  if (!gate.value || sending.value) return false;
  return gate.value.allowed || (bypassing.value && bypassReason.value.trim().length >= 5);
});

async function send() {
  sending.value = true;
  fieldErrors.value = {};
  try {
    await api.moveTag(props.promptId, props.tag, props.version, props.reason, gate.value?.allowed ? null : bypassReason.value.trim());
    $q.notify({ message: `"${props.tag}" now points to v${props.version}`, color: "positive", timeout: 3000 });
    emit("moved");
    emit("close");
  } catch (error) {
    fieldErrors.value = (error as { fields?: Record<string, string> }).fields ?? {};
    $q.notify({ message: `Could not promote: ${describeApiError(error as Error)}`, color: "negative", timeout: 5000 });
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Modal :title="`Promote v${version} to ${tag}`" medium @close="emit('close')">
    <div class="promote" data-testid="promote-modal">
      <p v-if="preview.loading.value && !preview.data.value" class="muted">Checking the evaluation of v{{ version }}…</p>
      <p v-else-if="preview.error.value" class="problem" role="alert" data-testid="promote-error">{{ describeApiError(preview.error.value) }}</p>
      <template v-else-if="gate && verdict">
        <dl class="facts">
          <dt>Evaluation</dt>
          <dd><StatusChip :tone="verdict.tone" :label="verdict.label" data-testid="promote-verdict" /></dd>
          <template v-if="gate.requiredRuns > 1">
            <dt>Runs needed</dt>
            <dd>{{ gate.requiredRuns }} passing in a row</dd>
          </template>
        </dl>
        <p class="reason" data-testid="promote-reason">{{ gate.reason }}</p>
        <ul v-if="gate.runs.some((r) => r.failures.length)" class="failures" data-testid="promote-failures">
          <template v-for="r in gate.runs" :key="r.runId">
            <li v-for="f in r.failures" :key="r.runId + f.evaluator">
              <template v-if="f.incomplete"><b>{{ f.evaluator }}</b> scored only {{ f.incomplete.scored }} of {{ f.incomplete.items }} items <span class="muted">(the rest failed to run, so its pass rate says nothing about the run)</span></template>
              <template v-else><b>{{ f.evaluator }}</b> {{ f.passRate === null ? "has no results" : `${Math.round(f.passRate * 100)}%` }} <span class="muted">(target {{ Math.round(f.target * 100) }}%)</span></template>
            </li>
          </template>
        </ul>

        <template v-if="!gate.allowed && gate.verdict !== 'policy_incomplete'">
          <p class="hint">Run the offline evaluation on the policy's dataset with the agent reading v{{ version }} (<code>memtrace.prompts</code>), then come back.</p>
        </template>
        <template v-if="!gate.allowed">
          <label v-if="canBypass" class="bypass">
            <input v-model="bypassing" type="checkbox" data-testid="bypass-toggle" /> Promote anyway (emergency)
          </label>
          <p v-else class="hint" data-testid="no-bypass">Skipping the evaluation needs the governance permission.</p>
          <label v-if="bypassing" class="field">
            <span>Why? It stays in the history of this prompt.</span>
            <TextInput v-model="bypassReason" multiline :rows="2" :invalid="!!fieldErrors.bypassReason" data-testid="bypass-reason" />
            <span v-if="fieldErrors.bypassReason" class="field-error">{{ fieldErrors.bypassReason }}</span>
          </label>
        </template>
      </template>
      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">Cancel</button>
        <button type="button" class="primary-btn" :disabled="!canSend" data-testid="promote-confirm" @click="send">{{ sending ? "Promoting…" : gate && !gate.allowed ? "Promote anyway" : "Promote" }}</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.promote { display: flex; flex-direction: column; gap: 14px; min-width: min(560px, 80vw); }
.facts { display: grid; grid-template-columns: 110px 1fr; gap: 10px 12px; margin: 0; font-size: 14px; align-items: center; }
dt { color: var(--mt-muted); }
dd { margin: 0; }
.muted { color: var(--mt-muted); font-size: 12px; }
.reason { margin: 0; font-size: 14px; line-height: 1.5; }
.failures { margin: 0; padding-left: 18px; font-size: 13px; }
.hint { margin: 0; font-size: 13px; color: var(--mt-muted); line-height: 1.5; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.bypass { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.field-error { color: var(--mt-err-ink); font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.ghost { height: 36px; padding: 0 16px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.primary-btn { height: 36px; padding: 0 18px; border: none; border-radius: var(--mt-radius-lg); background: var(--mt-accent); color: var(--mt-accent-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
