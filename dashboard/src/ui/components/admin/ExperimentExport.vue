<script setup lang="ts">
import { computed, ref } from "vue";
import type { ExperimentDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { describeApiError } from "@/application/describe-api-error";
import { ApiError } from "@/application/trace-api";
import Button from "../Button.vue";
import FormField from "../FormField.vue";
import { dateLocale, t } from "../../i18n";

/**
 * Exportar los datos de un experimento (ADR-084) en JSON Lines: un tipo de dato y un rango de hasta 31 días por descarga.
 * Cada exportación queda en el registro de auditoría. Solo con `data:export`.
 */
const props = defineProps<{ experiment: ExperimentDto }>();

const api = useIdentityApi();

const KINDS = [
  { value: "traces", get label() { return t("experimentExport.traces"); }, get hint() { return t("experimentExport.every_span_with_its_attributes_and"); } },
  { value: "annotations", get label() { return t("experimentExport.human_annotations"); }, get hint() { return t("experimentExport.the_labels_people_put_on_traces"); } },
  { value: "feedback", get label() { return t("experimentExport.end_user_feedback"); }, get hint() { return t("experimentExport.thumbs_up_and_down_from_the"); } },
  { value: "scores", get label() { return t("experimentExport.evaluation_scores"); }, get hint() { return t("experimentExport.results_of_the_offline_evaluations"); } },
];

const day = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const kind = ref("traces");
const from = ref(day(new Date(today.getTime() - 7 * 86_400_000)));
const to = ref(day(today));
const checking = ref(false);
const error = ref<string | null>(null);
const ready = ref<{ rows: number; url: string } | null>(null);

// `to` es inclusivo para quien lo escribe: se exporta hasta el final de ese día
const range = computed(() => ({ kind: kind.value, from: `${from.value}T00:00:00.000Z`, to: new Date(new Date(`${to.value}T00:00:00.000Z`).getTime() + 86_400_000).toISOString() }));
const hint = computed(() => KINDS.find((k) => k.value === kind.value)?.hint ?? "");

async function check() {
  checking.value = true;
  error.value = null;
  ready.value = null;
  try {
    const { rows } = await api.previewExport(props.experiment.id, range.value);
    ready.value = { rows, url: api.exportUrl(props.experiment.id, range.value) };
  } catch (e) {
    // una petición mal formada dice qué campo falla (rango demasiado largo, fecha ausente...)
    const fields = e instanceof ApiError && e.status === 400 ? Object.values(e.fields ?? {}) : [];
    error.value = fields.length ? fields.join(" ") : describeApiError(e as Error);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="adm-card export">
    <h3 class="adm-section-title">{{ t("experimentExport.export_data") }}</h3>
    <p class="adm-hint">
      {{ t("experimentExport.download_the_data_of") + " " }}<strong>{{ experiment.name }}</strong>{{ " " + t("experimentExport.as_a_json_lines_file_one") }}
    </p>

    <div class="row">
      <FormField :label="t('experimentExport.what')">
        <select v-model="kind" :aria-label="t('experimentExport.kind_of_data')" @change="ready = null">
          <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
      </FormField>
      <FormField :label="t('experimentExport.from')">
        <input v-model="from" type="date" :aria-label="t('experimentExport.from_date')" @change="ready = null" />
      </FormField>
      <FormField :label="t('experimentExport.to_included')">
        <input v-model="to" type="date" :aria-label="t('experimentExport.to_date')" @change="ready = null" />
      </FormField>
      <Button variant="primary" :loading="checking" :disabled="!from || !to" @click="check">{{ t("experimentExport.prepare_export") }}</Button>
    </div>
    <p class="adm-hint">{{ hint }}</p>

    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div v-if="ready" class="ready">
      <span>{{ ready.rows === 1 ? t("experimentExport.count_record_ready", { count: ready.rows.toLocaleString(dateLocale("en-US")) }) : t("experimentExport.count_records_ready", { count: ready.rows.toLocaleString(dateLocale("en-US")) }) }}</span>
      <a v-if="ready.rows > 0" class="download" :href="ready.url" download>{{ t("experimentExport.download") }}</a>
      <span v-else class="adm-hint">{{ t("experimentExport.nothing_in_that_range") }}</span>
    </div>
  </div>
</template>

<style scoped>
.export {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.row {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}
select,
input {
  padding: 7px 9px;
  border: 1px solid var(--mt-border);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
}
.err {
  margin: 0;
  color: var(--mt-danger, #b42318);
  font-size: 13px;
}
.ready {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
/* un enlace de descarga real (clic central, copiar dirección): Button no sirve archivos, así que repite su aspecto principal */
.download {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 16px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.download:hover {
  opacity: 0.9;
}
.download:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: 2px;
}
</style>
