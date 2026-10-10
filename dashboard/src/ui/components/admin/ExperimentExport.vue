<script setup lang="ts">
import { computed, ref } from "vue";
import type { ExperimentDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { describeApiError } from "@/application/describe-api-error";
import { ApiError } from "@/application/trace-api";

/**
 * Exportar los datos de un experimento (ADR-084) en JSON Lines: un tipo de dato y un rango de hasta 31 días por descarga.
 * Cada exportación queda en el registro de auditoría. Solo con `data:export`.
 */
const props = defineProps<{ experiment: ExperimentDto }>();

const api = useIdentityApi();

const KINDS = [
  { value: "traces", label: "Traces", hint: "Every span, with its attributes and prompts if content capture is on" },
  { value: "annotations", label: "Human annotations", hint: "The labels people put on traces" },
  { value: "feedback", label: "End-user feedback", hint: "Thumbs up and down from the people using the agent" },
  { value: "scores", label: "Evaluation scores", hint: "Results of the offline evaluations" },
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
    <h3 class="adm-section-title">Export data</h3>
    <p class="adm-hint">
      Download the data of <strong>{{ experiment.name }}</strong> as a JSON Lines file (one record per line). Up to 31 days per file.
      Every export is recorded in the organization's audit log. Personal data was already masked before it was stored.
    </p>

    <div class="row">
      <label>
        <span class="lbl">What</span>
        <select v-model="kind" aria-label="Kind of data" @change="ready = null">
          <option v-for="k in KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
      </label>
      <label>
        <span class="lbl">From</span>
        <input v-model="from" type="date" aria-label="From date" @change="ready = null" />
      </label>
      <label>
        <span class="lbl">To (included)</span>
        <input v-model="to" type="date" aria-label="To date" @change="ready = null" />
      </label>
      <button class="adm-btn primary" type="button" :disabled="checking || !from || !to" @click="check">Prepare export</button>
    </div>
    <p class="adm-hint">{{ hint }}</p>

    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <div v-if="ready" class="ready">
      <span>{{ ready.rows.toLocaleString("en-US") }} record{{ ready.rows === 1 ? "" : "s" }} ready.</span>
      <a v-if="ready.rows > 0" class="adm-btn primary" :href="ready.url" download>Download</a>
      <span v-else class="adm-hint">Nothing in that range.</span>
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
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lbl {
  font-size: 12px;
  font-weight: 600;
  color: var(--mt-muted);
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
.ready a {
  text-decoration: none;
}
</style>
