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
  <Modal :title="budget ? 'Edit monthly budget' : 'Set a monthly budget'" @close="emit('close')">
    <form class="form" data-testid="budget-form" @submit.prevent="save">
      <p class="intro">You get an email once per month at each level: when the spend reaches the warning, when it exceeds the budget, and when the pace of the month points to exceeding it.</p>
      <FormField label="Budget per month (USD)" :error="errors.monthlyUsd">
        <TextInput v-model="form.monthlyUsd" type="number" aria-label="Monthly budget" placeholder="500" autofocus />
      </FormField>
      <FormField label="Warn me at (% of the budget)" :error="errors.warnPercent">
        <TextInput v-model="form.warnPercent" type="number" aria-label="Warning percentage" />
      </FormField>
      <FormField label="Email" :error="errors.recipients" hint="One address per line, up to 10.">
        <TextInput v-model="form.recipients" multiline :rows="3" placeholder="finance@example.com" aria-label="Recipients" />
      </FormField>
      <Checkbox v-model="form.enabled" variant="switch">Active</Checkbox>
      <p class="note">The cost is an estimate from the price catalog; a model without a price counts as zero.</p>
      <p v-if="generalError" class="general" role="alert">{{ generalError }}</p>
    </form>
    <template #footer>
      <Button @click="emit('close')">Cancel</Button>
      <Button variant="primary" :loading="saving" :disabled="!canSave" data-testid="budget-save" @click="save">Save budget</Button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
.intro, .note { margin: 0; font-size: 12px; line-height: 1.5; color: var(--mt-muted); }
.general { margin: 0; font-size: 13px; font-weight: 600; color: var(--mt-err-ink); }
</style>
