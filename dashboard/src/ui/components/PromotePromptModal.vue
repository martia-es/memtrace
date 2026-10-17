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
import FormField from "./FormField.vue";
import { t, tp } from "../i18n";

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
    $q.notify({ message: t("promotePromptModal.tag_now_points_to_v_version", { tag: props.tag, version: props.version }), color: "positive", timeout: 3000 });
    emit("moved");
    emit("close");
  } catch (error) {
    fieldErrors.value = (error as { fields?: Record<string, string> }).fields ?? {};
    $q.notify({ message: t("promotePromptModal.could_not_promote_error", { error: describeApiError(error as Error) }), color: "negative", timeout: 5000 });
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Modal :title="t('promotePromptModal.promote_v_version_to_tag', { version, tag })" medium @close="emit('close')">
    <div class="promote" data-testid="promote-modal">
      <p v-if="preview.loading.value && !preview.data.value" class="muted">{{ t("promotePromptModal.checking_the_evaluation_of_v_version", { version }) }}</p>
      <p v-else-if="preview.error.value" class="problem" role="alert" data-testid="promote-error">{{ describeApiError(preview.error.value) }}</p>
      <template v-else-if="gate && verdict">
        <dl class="facts">
          <dt>{{ t("promotePromptModal.evaluation") }}</dt>
          <dd><StatusChip :tone="verdict.tone" :label="verdict.label" data-testid="promote-verdict" /></dd>
          <template v-if="gate.requiredRuns > 1">
            <dt>{{ t("promotePromptModal.runs_needed") }}</dt>
            <dd>{{ t("promotePromptModal.count_passing_in_a_row", { count: gate.requiredRuns }) }}</dd>
          </template>
        </dl>
        <p class="reason" data-testid="promote-reason">{{ gate.reason }}</p>
        <section v-if="impact.data.value?.impact" class="impact" data-testid="promote-impact">
          <span class="eyebrow">{{ t("promotePromptModal.who_receives_it") }}</span>
          <ul v-if="affected.length > 0">
            <li v-for="a in affected" :key="a.experimentId + a.environment" :data-testid="`impact-${a.name}`"><b>{{ a.name }}</b> {{ t("promotePromptModal.in_environment_v_from_v_to", { environment: a.environment, from: a.from, to: a.to }) }}</li>
          </ul>
          <p v-else class="muted" data-testid="impact-none">{{ t("promotePromptModal.no_agent_follows_tag_right_now", { tag, version }) }}</p>
          <p v-if="impact.data.value.impact.pinned > 0" class="muted">{{ tp("promptPromote.fixed", impact.data.value.impact.pinned) }}</p>
          <p v-if="impact.data.value.impact.willBeBehind.length > 0" class="muted" data-testid="impact-behind">
            {{ impact.data.value.impact.willBeBehind.map((p) => p.name).join(", ") }} {{ t("promotePromptModal.include_this_fragment_through_tag_they", { tag }) }}
          </p>
        </section>
        <ul v-if="gate.runs.some((r) => r.failures.length)" class="failures" data-testid="promote-failures">
          <template v-for="r in gate.runs" :key="r.runId">
            <li v-for="f in r.failures" :key="r.runId + f.evaluator">
              <template v-if="f.incomplete"><b>{{ f.evaluator }}</b> {{ t("promotePromptModal.scored_only_scored_of_items_items", { scored: f.incomplete.scored, items: f.incomplete.items }) }} <span class="muted">{{ t("promotePromptModal.the_rest_failed_to_run_so") }}</span></template>
              <template v-else><b>{{ f.evaluator }}</b> {{ f.passRate === null ? t('promotePromptModal.has_no_results') : `${Math.round(f.passRate * 100)}%` }} <span class="muted">{{ t('promotePromptModal.target_percent', { percent: Math.round(f.target * 100) }) }}</span></template>
            </li>
          </template>
        </ul>

        <template v-if="!gate.allowed && gate.verdict !== 'policy_incomplete'">
          <p class="hint">{{ t("promotePromptModal.run_the_offline_evaluation_on_the", { version }) }}<code>memtrace.prompts</code>{{ t("promotePromptModal.then_come_back") }}</p>
        </template>
        <template v-if="!gate.allowed">
          <Checkbox v-if="canBypass" class="bypass" v-model="bypassing" data-testid="bypass-toggle">{{ " " + t("promotePromptModal.promote_anyway_emergency") }}</Checkbox>
          <p v-else class="hint" data-testid="no-bypass">{{ t("promotePromptModal.skipping_the_evaluation_needs_the_govern") }}</p>
          <FormField :label="t('promotePromptModal.why_it_stays_in_the_history')" v-if="bypassing">
            <TextInput v-model="bypassReason" multiline :rows="2" :invalid="!!fieldErrors.bypassReason" data-testid="bypass-reason" />
            <span v-if="fieldErrors.bypassReason" class="field-error">{{ fieldErrors.bypassReason }}</span>
          </FormField>
        </template>
      </template>
      <div class="actions">
        <Button @click="emit('close')">{{ t("promotePromptModal.cancel") }}</Button>
        <Button variant="primary" :disabled="!canSend" data-testid="promote-confirm" @click="send">{{ sending ? t("promotePromptModal.promoting") : gate && !gate.allowed ? t("promotePromptModal.promote_anyway") : t("promotePromptModal.promote") }}</Button>
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

.field-error { color: var(--mt-err-ink); font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; }
.ghost { height: 36px; padding: 0 16px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }

</style>
