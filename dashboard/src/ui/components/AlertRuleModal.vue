<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { AlertRuleDto } from "@contract";
import type { AlertRuleBody, SavedCustomMetricDto } from "@/application/identity-api";
import { ApiError } from "@/application/trace-api";
import { describeApiError } from "@/application/describe-api-error";
import { useIdentityApi } from "../composables/useIdentityApi";
import { METRICS, REMINDERS, WINDOWS, metricUnit, needsSamples, parseRecipients, samplesLabel } from "../alert-format";
import Button from "./Button.vue";
import Checkbox from "./Checkbox.vue";
import FormField from "./FormField.vue";
import Modal from "./Modal.vue";
import SegmentedControl from "./SegmentedControl.vue";
import Select from "./Select.vue";
import TextInput from "./TextInput.vue";

/**
 * Crear o cambiar una regla de alerta (ADR-086). Los campos se validan en la API; aquí solo se enseña qué campo falló. Una regla
 * `custom` mide una gráfica guardada con un solo paso y sin desglose, así que solo se ofrecen esas.
 */
const props = defineProps<{ experimentId: string; rule?: AlertRuleDto; charts: SavedCustomMetricDto[] }>();
const emit = defineEmits<{ close: []; saved: [rule: AlertRuleDto] }>();

const api = useIdentityApi();

const form = reactive({
  name: props.rule?.name ?? "",
  metric: (props.rule?.metric ?? "error_rate") as AlertRuleDto["metric"],
  customMetricId: props.rule?.customMetricId ?? null,
  comparator: (props.rule?.comparator ?? "above") as AlertRuleDto["comparator"],
  // un campo numérico emite un número al escribir y un texto vacío al borrar: se guardan tal cual y se leen con String()/Number()
  threshold: (props.rule ? props.rule.threshold : "") as string | number,
  windowMinutes: props.rule?.windowMinutes ?? 15,
  minSamples: (props.rule?.minSamples || 20) as string | number,
  // 0 = no repetir: el selector necesita un valor que pueda mostrar, y `null` no lo es
  reminder: props.rule?.reminderMinutes ?? 0,
  recipients: (props.rule?.recipients ?? []).join("\n"),
  enabled: props.rule?.enabled ?? true,
});
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const generalError = ref<string | null>(null);

const METRIC_OPTIONS = METRICS.map((m) => ({ label: m.label, value: m.value }));
const WINDOW_OPTIONS = WINDOWS.map((w) => ({ label: w.label, value: w.value }));
const REMINDER_OPTIONS = REMINDERS.map((r) => ({ label: r.label, value: r.value ?? 0 }));
const COMPARATORS = [
  { value: "above", label: "Goes above" },
  { value: "below", label: "Falls below" },
];

// una alerta mide UN número: gráficas con un solo paso y sin desglose por un detalle
const usableCharts = computed(() => props.charts.filter((c) => c.definition.stepTypes.length === 1 && !c.definition.groupByAttribute));
const chartOptions = computed(() => usableCharts.value.map((c) => ({ label: c.name, value: c.id })));
const unit = computed(() => metricUnit(form.metric));
const metricHint = computed(() => METRICS.find((m) => m.value === form.metric)?.hint ?? "");
const threshold = computed(() => (String(form.threshold).trim() === "" ? null : Number(form.threshold)));
const canSave = computed(() => form.name.trim() !== "" && threshold.value !== null && Number.isFinite(threshold.value) && (form.metric !== "custom" || form.customMetricId !== null));

function body(): AlertRuleBody {
  return {
    name: form.name.trim(),
    metric: form.metric,
    customMetricId: form.metric === "custom" ? form.customMetricId : null,
    comparator: form.comparator,
    threshold: threshold.value as number,
    windowMinutes: form.windowMinutes,
    minSamples: needsSamples(form.metric) ? Number(form.minSamples) : 0,
    reminderMinutes: form.reminder || null,
    recipients: parseRecipients(form.recipients),
    enabled: form.enabled,
  };
}

async function save() {
  saving.value = true;
  errors.value = {};
  generalError.value = null;
  try {
    const saved = props.rule ? await api.updateAlertRule(props.experimentId, props.rule.id, body()) : await api.createAlertRule(props.experimentId, body());
    emit("saved", saved);
  } catch (error) {
    // la API dice qué campo falla; lo que no se puede atribuir a uno se enseña arriba
    if (error instanceof ApiError && error.status === 400 && error.fields && Object.keys(error.fields).length > 0) errors.value = error.fields;
    else generalError.value = describeApiError(error as Error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal :title="rule ? 'Edit alert' : 'New alert'" @close="emit('close')">
    <form class="form" data-testid="alert-form" @submit.prevent="save">
      <FormField label="Name" :error="errors.name">
        <TextInput v-model="form.name" placeholder="e.g. Too many errors" autofocus aria-label="Alert name" />
      </FormField>

      <FormField label="Measure" :hint="metricHint" :error="errors.metric" as="div">
        <Select v-model="form.metric" :options="METRIC_OPTIONS" aria-label="Metric" />
      </FormField>

      <FormField v-if="form.metric === 'custom'" label="Chart" :error="errors.customMetricId" as="div" :hint="usableCharts.length ? 'Only charts about one step, with no split by a detail' : undefined">
        <Select v-if="usableCharts.length" v-model="form.customMetricId" :options="chartOptions" placeholder="Choose a saved chart" aria-label="Custom chart" />
        <p v-else class="empty">You have no chart this can use yet. Save one in Overview › Custom charts, about a single step and without splitting it by a detail.</p>
      </FormField>

      <div class="row">
        <FormField label="When it" as="div">
          <SegmentedControl v-model="form.comparator" :options="COMPARATORS" aria-label="Direction" />
        </FormField>
        <FormField label="This value" :error="errors.threshold">
          <span class="with-unit">
            <TextInput v-model="form.threshold" type="number" aria-label="Threshold" placeholder="0" />
            <span v-if="unit" class="unit">{{ unit }}</span>
          </span>
        </FormField>
        <FormField label="Over the last" :error="errors.windowMinutes" as="div">
          <Select v-model="form.windowMinutes" :options="WINDOW_OPTIONS" aria-label="Window" />
        </FormField>
      </div>

      <FormField
        v-if="needsSamples(form.metric)"
        :label="`Needs at least this many ${samplesLabel(form.metric)}`"
        :error="errors.minSamples"
        :hint="`With fewer, the alert stays quiet: two failed ${samplesLabel(form.metric)} are not a 100 % error rate.`"
      >
        <TextInput v-model="form.minSamples" type="number" aria-label="Minimum samples" />
      </FormField>

      <FormField label="Email" :error="errors.recipients" hint="One address per line, up to 10. They get a message when it fires and when it is back to normal; no conversation content is included.">
        <TextInput v-model="form.recipients" multiline :rows="3" placeholder="oncall@example.com" aria-label="Recipients" />
      </FormField>

      <FormField label="Remind me" :error="errors.reminderMinutes" as="div">
        <Select v-model="form.reminder" :options="REMINDER_OPTIONS" aria-label="Reminder" />
      </FormField>

      <Checkbox v-model="form.enabled" variant="switch">Active</Checkbox>

      <p v-if="generalError" class="general" role="alert">{{ generalError }}</p>
    </form>
    <template #footer>
      <Button @click="emit('close')">Cancel</Button>
      <Button variant="primary" :loading="saving" :disabled="!canSave" data-testid="alert-save" @click="save">{{ rule ? "Save changes" : "Create alert" }}</Button>
    </template>
  </Modal>
</template>

<style scoped>
.form { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start; }
.with-unit { display: inline-flex; align-items: center; gap: 8px; }
.unit { font-size: 13px; color: var(--mt-muted); }
.empty { margin: 0; font-size: 12px; color: var(--mt-muted); }
.general { margin: 0; font-size: 13px; font-weight: 600; color: var(--mt-err-ink); }
</style>
