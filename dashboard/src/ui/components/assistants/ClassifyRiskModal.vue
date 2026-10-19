<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import { RISK_DESCRIPTION, RISK_LABEL, RISK_LEVELS, isLowering, type RiskLevel } from "@/domain/risk";
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Button from "../Button.vue";
import FormField from "../FormField.vue";
import Modal from "../Modal.vue";
import Radio from "../Radio.vue";
import TextInput from "../TextInput.vue";
import { t } from "../../i18n";

/**
 * Clasifica el riesgo de un agente (ADR-102): nivel, finalidad prevista y limitaciones. Parte de lo declarado. Avisa de lo que
 * cambia: bajar el nivel solo lo hace un administrador de la organización y acorta la retención de sus trazas (la del nivel nuevo).
 */
const props = defineProps<{ experimentId: string; name: string; levelDays: Record<string, number>; canLower: boolean }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();

const current = ref<RiskLevel | null>(null);
const loaded = ref(false);
const form = reactive<{ level: RiskLevel | null; intendedPurpose: string; knownLimitations: string }>({ level: null, intendedPurpose: "", knownLimitations: "" });
const fieldErrors = ref<Record<string, string>>({});
const saving = ref(false);

onMounted(async () => {
  try {
    const risk = (await api.getAssistant(props.experimentId)).risk;
    current.value = risk.level;
    form.level = risk.level;
    form.intendedPurpose = risk.intendedPurpose;
    form.knownLimitations = risk.knownLimitations;
  } finally {
    loaded.value = true;
  }
});

const purposeLabel = computed(() => `${t("classifyRisk.intended_purpose")} ${t("classifyRisk.required_for_high")}`);
const lowering = computed(() => form.level !== null && isLowering(current.value, form.level));
const blocked = computed(() => lowering.value && !props.canLower);
const purposeMissing = computed(() => form.level === "high" && form.intendedPurpose.trim() === "");
// la retención del agente es la de su nivel: cambiar de nivel puede acortarla
const fromDays = computed(() => props.levelDays[current.value ?? "unclassified"]);
const toDays = computed(() => (form.level ? props.levelDays[form.level] : undefined));
const shortens = computed(() => fromDays.value !== undefined && toDays.value !== undefined && toDays.value < fromDays.value);

async function save() {
  if (!form.level || blocked.value || purposeMissing.value) return;
  saving.value = true;
  try {
    await api.classifyRisk(props.experimentId, { level: form.level, intendedPurpose: form.intendedPurpose.trim(), knownLimitations: form.knownLimitations.trim() });
    $q.notify({ message: t("classifyRisk.risk_level_saved"), color: "positive", timeout: 2000 });
    emit("saved");
  } catch (error) {
    fieldErrors.value = (error as { fields?: Record<string, string> }).fields ?? {};
    $q.notify({ message: t("classifyRisk.could_not_classify_error", { error: describeApiError(error as Error) }), color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="t('classifyRisk.risk_level_name', { name })" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <fieldset class="levels">
        <legend>{{ t("classifyRisk.level") }}</legend>
        <Radio v-for="l in RISK_LEVELS" :key="l" v-model="form.level" :value="l" name="risk-level" :data-testid="`level-${l}`" class="option">
          <span><b>{{ RISK_LABEL[l] }}</b><br /><small>{{ RISK_DESCRIPTION[l] }}</small></span>
        </Radio>
      </fieldset>
      <FormField :label="purposeLabel">
        <TextInput multiline v-model="form.intendedPurpose" :rows="3" :invalid="purposeMissing || !!fieldErrors.intendedPurpose" data-testid="intended-purpose" />
        <span v-if="purposeMissing || fieldErrors.intendedPurpose" class="field-error">{{ fieldErrors.intendedPurpose ?? t("classifyRisk.required_for_a_high_risk_agent") }}</span>
      </FormField>
      <FormField :label="t('classifyRisk.known_limitations')">
        <TextInput multiline v-model="form.knownLimitations" :rows="2" data-testid="known-limitations" />
      </FormField>
      <p v-if="blocked" class="warn" data-testid="lowering-blocked">{{ t("classifyRisk.lowering_the_level_needs_an_organization_admin") }}</p>
      <p v-else-if="shortens" class="warn" data-testid="retention-shortens">{{ t("classifyRisk.its_traces_will_be_kept_to_days", { to: toDays, from: fromDays }) }}</p>
      <p class="hint">{{ t("classifyRisk.you_declare_the_level_memtrace_does_not") }}</p>
      <div class="actions"><Button variant="primary" type="submit" :disabled="saving || !loaded || !form.level || blocked || purposeMissing" data-testid="save-risk">{{ t("classifyRisk.save") }}</Button></div>
    </form>
  </Modal>
</template>

<style scoped>
.levels { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; }
.levels legend { font-weight: 700; margin-bottom: 6px; padding: 0; }
.option { padding: 9px 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.option small { color: var(--mt-muted); font-size: 12px; }
.warn { margin: 0; font-size: 12px; color: var(--mt-warn-ink); }
.hint { margin: 0; font-size: 12px; color: var(--mt-muted); line-height: 1.5; }
.field-error { font-size: 12px; color: var(--mt-err-ink); }
.actions { display: flex; justify-content: flex-end; }
</style>
