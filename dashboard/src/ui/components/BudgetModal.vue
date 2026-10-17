<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { BudgetViewDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import { describeApiError } from "@/application/describe-api-error";
import { useIdentityApi } from "../composables/useIdentityApi";
import { parseRecipients } from "../alert-format";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";
import FormField from "./FormField.vue";
import Modal from "./Modal.vue";
import TextInput from "./TextInput.vue";
import { t } from "../i18n";

/** Presupuesto mensual de coste del agente (ADR-086): cuánto, a qué porcentaje avisar y a quién. */
const props = defineProps<{ experimentId: string; budget: BudgetViewDto | null }>();
const emit = defineEmits<{ close: []; saved: [budget: BudgetViewDto] }>();

const api = useIdentityApi();
const form = reactive({
  // un campo numérico emite un número al escribir y un texto vacío al borrar
  monthlyUsd: (props.budget ? props.budget.budget.monthlyUsd : "") as string | number,
  warnPercent: (props.budget?.budget.warnPercent ?? 80) as string | number,
  recipients: (props.budget?.budget.recipients ?? []).join("\n"),
  enabled: props.budget?.budget.enabled ?? true,
});
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const generalError = ref<string | null>(null);
const canSave = computed(() => Number(form.monthlyUsd) > 0 && String(form.warnPercent).trim() !== "");

async function save() {
  saving.value = true;
  errors.value = {};
  generalError.value = null;
  try {
    emit(
      "saved",
      await api.setBudget(props.experimentId, {
        monthlyUsd: Number(form.monthlyUsd),
        warnPercent: Number(form.warnPercent),
        recipients: parseRecipients(form.recipients),
        enabled: form.enabled,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 400 && error.fields && Object.keys(error.fields).length > 0) errors.value = error.fields;
    else generalError.value = describeApiError(error as Error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="budget ? t('budgetModal.edit_monthly_budget') : t('budgetModal.set_a_monthly_budget')" @close="emit('close')">
    <form class="form" data-testid="budget-form" @submit.prevent="save">
      <p class="intro">{{ t("budgetModal.you_get_an_email_once_per") }}</p>
      <FormField :label="t('budgetModal.budget_per_month_usd')" :error="errors.monthlyUsd">
        <TextInput v-model="form.monthlyUsd" type="number" :aria-label="t('budgetModal.monthly_budget')" placeholder="500" autofocus />
      </FormField>
      <FormField :label="t('budgetModal.warn_me_at_of_the_budget')" :error="errors.warnPercent">
        <TextInput v-model="form.warnPercent" type="number" :aria-label="t('budgetModal.warning_percentage')" />
      </FormField>
      <FormField :label="t('budgetModal.email')" :error="errors.recipients" :hint="t('budgetModal.one_address_per_line_up_to')">
        <TextInput v-model="form.recipients" multiline :rows="3" :placeholder="t('budgetModal.finance_example_com')" :aria-label="t('budgetModal.recipients')" />
      </FormField>
      <Checkbox v-model="form.enabled" variant="switch">{{ t("budgetModal.active") }}</Checkbox>
      <p class="note">{{ t("budgetModal.the_cost_is_an_estimate_from") }}</p>
      <p v-if="generalError" class="general" role="alert">{{ generalError }}</p>
    </form>
    <template #footer>
      <Button @click="emit('close')">{{ t("budgetModal.cancel") }}</Button>
      <Button variant="primary" :loading="saving" :disabled="!canSave" data-testid="budget-save" @click="save">{{ t("budgetModal.save_budget") }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
.intro, .note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--mt-muted); }
.general { margin: 0; font-size: 13px; font-weight: 600; color: var(--mt-err-ink); }
</style>
