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
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";

/**
 * Promoción de una versión a un entorno protegido (ADR-070). Antes de mover el tag dice si hay una evaluación exitosa de
 * esa versión y, si no, por qué. Saltarse el gate exige permiso de gobernanza y un motivo, que queda en el historial.
 */
const props = defineProps<{ promptId: string; tag: string; version: number; reason: string; canBypass: boolean }>();
const emit = defineEmits<{ close: []; moved: [] }>();

const api = usePromptApi();
const $q = useQuasar();
const preview = useAsync((signal) => api.previewGate(props.promptId, props.tag, props.version, signal));
// a quién llegaría el cambio (ADR-074); si falla no impide promover: es información, no un requisito
const impact = useAsync((signal) => api.map(props.promptId, { tag: props.tag, version: props.version }, signal));
onMounted(() => {
  void preview.run();
  void impact.run();
});
const affected = computed(() => (impact.data.value?.impact?.agents ?? []).filter((a) => a.changes));

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
        <section v-if="impact.data.value?.impact" class="impact" data-testid="promote-impact">
          <span class="eyebrow">WHO RECEIVES IT</span>
          <ul v-if="affected.length > 0">
            <li v-for="a in affected" :key="a.experimentId + a.environment" :data-testid="`impact-${a.name}`"><b>{{ a.name }}</b> in {{ a.environment }}: v{{ a.from }} → v{{ a.to }}</li>
          </ul>
          <p v-else class="muted" data-testid="impact-none">No agent follows "{{ tag }}" right now, or they already run v{{ version }}: nothing changes when you move it.</p>
          <p v-if="impact.data.value.impact.pinned > 0" class="muted">{{ impact.data.value.impact.pinned }} agent {{ impact.data.value.impact.pinned === 1 ? "uses" : "use" }} a fixed version and will not notice.</p>
          <p v-if="impact.data.value.impact.willBeBehind.length > 0" class="muted" data-testid="impact-behind">
            {{ impact.data.value.impact.willBeBehind.map((p) => p.name).join(", ") }} include this fragment through "{{ tag }}": they keep their text and will show as behind until rebuilt.
          </p>
        </section>
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
          <Checkbox v-if="canBypass" class="bypass" v-model="bypassing" data-testid="bypass-toggle"> Promote anyway (emergency)</Checkbox>
          <p v-else class="hint" data-testid="no-bypass">Skipping the evaluation needs the governance permission.</p>
          <label v-if="bypassing" class="field">
            <span>Why? It stays in the history of this prompt.</span>
            <TextInput v-model="bypassReason" multiline :rows="2" :invalid="!!fieldErrors.bypassReason" data-testid="bypass-reason" />
            <span v-if="fieldErrors.bypassReason" class="field-error">{{ fieldErrors.bypassReason }}</span>
          </label>
        </template>
      </template>
      <div class="actions">
        <Button @click="emit('close')">Cancel</Button>
        <Button variant="primary" :disabled="!canSend" data-testid="promote-confirm" @click="send">{{ sending ? "Promoting…" : gate && !gate.allowed ? "Promote anyway" : "Promote" }}</Button>
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
.impact { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--mt-line); font-size: 13px; }
.impact ul { margin: 0; padding-left: 18px; }
.impact p { margin: 0; }
.eyebrow { font-size: 11px; letter-spacing: 0.06em; color: var(--mt-muted); }
.reason { margin: 0; font-size: 14px; line-height: 1.5; }
.failures { margin: 0; padding-left: 18px; font-size: 13px; }
.hint { margin: 0; font-size: 13px; color: var(--mt-muted); line-height: 1.5; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.bypass { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.field-error { color: var(--mt-err-ink); font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.ghost { height: 36px; padding: 0 16px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }

</style>
