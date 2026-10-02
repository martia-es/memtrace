<script setup lang="ts">
import type { CustomMetricDefinitionDto, CustomMetricPointDto } from "@contract";
import type { EChartsCoreOption } from "echarts/core";
import { computed, reactive, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { customMetricChartOption } from "../custom-metric-chart-option";
import EChart from "./EChart.vue";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import type { SavedCustomMetricDto } from "@/application/identity-api";
import type { RangeParams } from "@/application/trace-api";

const props = defineProps<{ experimentId: string; range: RangeParams }>();

const api = useTraceApi();
const identityApi = useIdentityApi();
const $q = useQuasar();

// ---- descubrimiento (ADR-027): tipos de paso disponibles, detectados de las trazas del usuario ----
const stepKinds = ref<{ stepType: string; count: number }[]>([]);
const stepKindsLoading = ref(false);
async function loadStepKinds() {
  stepKindsLoading.value = true;
  try {
    const { items } = await api.getStepKinds(props.range);
    stepKinds.value = items;
  } catch {
    stepKinds.value = [];
  } finally {
    stepKindsLoading.value = false;
  }
}

// ---- estado del builder ----
const chartType = ref<CustomMetricDefinitionDto["chartType"]>("bar");
const selectedStepTypes = ref<Set<string>>(new Set());
const metric = ref<CustomMetricDefinitionDto["metric"]>("count");
const groupByAttribute = ref("");

// ---- claves de atributo detectadas en los step types elegidos (ADR-030): alimenta los dos selects de abajo ----
const attributeKeys = ref<{ key: string; count: number }[]>([]);
const attributeKeysLoading = ref(false);

async function loadAttributeKeys() {
  attributeKeys.value = [];
  if (selectedStepTypes.value.size === 0) return;
  attributeKeysLoading.value = true;
  try {
    const { items } = await api.getAttributeKeys({ ...props.range, stepTypes: [...selectedStepTypes.value] });
    attributeKeys.value = items;
  } catch {
    attributeKeys.value = [];
  } finally {
    attributeKeysLoading.value = false;
  }
}

interface FilterRow {
  attribute: string;
  values: { value: string; count: number }[];
  selected: Set<string>;
  loading: boolean;
}
const filterRows = ref<FilterRow[]>([]);

function addFilterRow() {
  filterRows.value.push({ attribute: "", values: [], selected: new Set(), loading: false });
}

function removeFilterRow(index: number) {
  filterRows.value.splice(index, 1);
  previewResult.value = null;
}

async function loadFilterRowValues(row: FilterRow) {
  row.values = [];
  row.selected = new Set();
  if (!row.attribute || selectedStepTypes.value.size === 0) return;
  row.loading = true;
  try {
    const { items } = await api.getAttributeValues({ ...props.range, stepTypes: [...selectedStepTypes.value], attribute: row.attribute });
    row.values = items;
  } catch {
    row.values = [];
  } finally {
    row.loading = false;
  }
}

function toggleFilterRowValue(row: FilterRow, value: string) {
  if (row.selected.has(value)) row.selected.delete(value);
  else row.selected.add(value);
  row.selected = new Set(row.selected);
  previewResult.value = null;
}

function toggleStep(id: string) {
  if (selectedStepTypes.value.has(id)) selectedStepTypes.value.delete(id);
  else selectedStepTypes.value.add(id);
  selectedStepTypes.value = new Set(selectedStepTypes.value);
  previewResult.value = null;
  void loadAttributeKeys();
}

function currentDefinition(): CustomMetricDefinitionDto {
  return {
    chartType: chartType.value,
    stepTypes: [...selectedStepTypes.value],
    metric: metric.value,
    groupByAttribute: groupByAttribute.value.trim() || null,
    filters: filterRows.value
      .filter((r) => r.attribute && r.selected.size > 0)
      .map((r) => ({ attribute: r.attribute, values: [...r.selected] })),
  };
}

// ---- plain-language summary of what ends up on each axis/series, from the current selection ----
const axisSummary = computed(() => {
  const isTimeBased = chartType.value === "line" || chartType.value === "area";
  const xAxis = isTimeBased ? "time (bucketed automatically)" : groupByAttribute.value ? `value of "${groupByAttribute.value}"` : "step type";
  const series = isTimeBased ? (groupByAttribute.value ? `one line per value of "${groupByAttribute.value}"` : "one line per step type") : null;
  return { xAxis, series };
});

// ---- vista previa ----
const previewResult = ref<{ points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] } | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

async function runPreview() {
  previewLoading.value = true;
  previewError.value = null;
  try {
    previewResult.value = await api.queryCustomMetric(currentDefinition(), props.range);
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : "Could not compute the chart";
    previewResult.value = null;
  } finally {
    previewLoading.value = false;
  }
}

function resetBuilder() {
  selectedStepTypes.value = new Set();
  groupByAttribute.value = "";
  filterRows.value = [];
  attributeKeys.value = [];
  previewResult.value = null;
  previewError.value = null;
}

// ---- opciones de ECharts a partir del resultado (compartido con MetricReportView, ADR-033) ----
function optionFor(result: { points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] }, type: CustomMetricDefinitionDto["chartType"]): EChartsCoreOption {
  return customMetricChartOption(result, type, $q.dark.isActive);
}

const previewOption = computed(() => (previewResult.value && chartType.value !== "table" && chartType.value !== "number" ? optionFor(previewResult.value, chartType.value) : null));
const previewTotal = computed(() => previewResult.value?.points.reduce((sum, p) => sum + p.value, 0) ?? 0);

// ---- guardados ----
const saved = ref<SavedCustomMetricDto[]>([]);
const savedResults = reactive<Record<string, { points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] } | null>>({});
const savedLoading = ref(false);
const newChartName = ref("");
const saving = ref(false);

async function loadSaved() {
  savedLoading.value = true;
  try {
    saved.value = await identityApi.listCustomMetrics(props.experimentId);
    await Promise.all(
      saved.value.map(async (m) => {
        try {
          savedResults[m.id] = await api.queryCustomMetric(m.definition, props.range);
        } catch {
          savedResults[m.id] = null;
        }
      }),
    );
  } finally {
    savedLoading.value = false;
  }
}

async function saveChart() {
  if (!newChartName.value.trim() || selectedStepTypes.value.size === 0) return;
  saving.value = true;
  try {
    await identityApi.createCustomMetric(props.experimentId, newChartName.value.trim(), currentDefinition());
    newChartName.value = "";
    await loadSaved();
  } finally {
    saving.value = false;
  }
}

async function removeSaved(id: string) {
  await identityApi.deleteCustomMetric(props.experimentId, id);
  saved.value = saved.value.filter((m) => m.id !== id);
  delete savedResults[id];
}

watch(() => props.range, () => { void loadStepKinds(); void loadSaved(); }, { immediate: true });
watch(() => props.experimentId, () => void loadSaved());

const CHART_TYPES: { value: CustomMetricDefinitionDto["chartType"]; label: string }[] = [
  { value: "bar", label: "Bars" },
  { value: "pie", label: "Pie" },
  { value: "line", label: "Line" },
  { value: "area", label: "Area" },
  { value: "number", label: "Number" },
  { value: "table", label: "Table" },
];
const METRICS: { value: CustomMetricDefinitionDto["metric"]; label: string }[] = [
  { value: "count", label: "Number of times" },
  { value: "avg_duration", label: "Average duration" },
  { value: "p50_duration", label: "Median duration (p50)" },
  { value: "p95_duration", label: "p95 duration" },
  { value: "error_rate", label: "Error rate" },
];
</script>

<template>
  <section class="detail-panel custom-charts">
    <div class="panel-header">
      <div>
        <h3>Custom charts</h3>
        <span class="panel-hint">Build a chart from your own instrumented spans — no query language required.</span>
      </div>
    </div>

    <div class="builder">
      <div class="builder-step">
        <div class="step-head">
          <span class="step-num">1</span>
          <div class="step-title">Chart type</div>
        </div>
        <div class="step-body">
          <div class="type-row">
            <button v-for="t in CHART_TYPES" :key="t.value" type="button" class="type-btn" :class="{ on: chartType === t.value }" @click="chartType = t.value; previewResult = null">
              {{ t.label }}
            </button>
          </div>
        </div>
      </div>

      <div class="builder-step">
        <div class="step-head">
          <span class="step-num">2</span>
          <div class="step-title">Step type(s)</div>
          <span class="step-caption">Detected from your traces</span>
        </div>
        <div class="step-body">
          <div class="chip-select">
            <span v-if="stepKindsLoading" class="hint">Loading…</span>
            <span v-else-if="!stepKinds.length" class="hint">No spans in this range yet.</span>
            <button
              v-for="s in stepKinds"
              :key="s.stepType"
              type="button"
              class="chip"
              :class="{ on: selectedStepTypes.has(s.stepType) }"
              @click="toggleStep(s.stepType)"
            >
              {{ s.stepType }}<span class="n">{{ s.count }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="builder-step">
        <div class="step-head">
          <span class="step-num">3</span>
          <div class="step-title">Metric &amp; grouping</div>
        </div>
        <div class="step-body">
          <div class="row">
            <div class="field">
              <label>Metric</label>
              <select v-model="metric" class="text-input" @change="previewResult = null">
                <option v-for="m in METRICS" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
            </div>
            <div class="field">
              <label>Group by attribute (optional)</label>
              <select v-model="groupByAttribute" class="text-input" :disabled="selectedStepTypes.size === 0" @change="previewResult = null">
                <option value="">— don't group, break down by step type —</option>
                <option v-for="k in attributeKeys" :key="k.key" :value="k.key">{{ k.key }} ({{ k.count }})</option>
              </select>
              <span v-if="attributeKeysLoading" class="hint">Loading attributes…</span>
              <span v-else-if="selectedStepTypes.size > 0 && !attributeKeys.length" class="hint">No attributes found on the selected step type(s).</span>
            </div>
          </div>
          <p class="hint axis-summary">
            X axis: <strong>{{ axisSummary.xAxis }}</strong><template v-if="axisSummary.series"> · Series: <strong>{{ axisSummary.series }}</strong></template>
          </p>
        </div>
      </div>

      <div class="builder-step">
        <div class="step-head">
          <span class="step-num">4</span>
          <div class="step-title">Filters</div>
          <span class="step-caption">Optional — narrows the dataset before computing the metric</span>
        </div>
        <div class="step-body">
          <div v-for="(row, i) in filterRows" :key="i" class="filter-block">
            <div class="filter-row">
              <select v-model="row.attribute" class="text-input" :disabled="selectedStepTypes.size === 0" @change="loadFilterRowValues(row)">
                <option value="">Choose an attribute…</option>
                <option v-for="k in attributeKeys" :key="k.key" :value="k.key">{{ k.key }} ({{ k.count }})</option>
              </select>
              <q-btn flat dense no-caps size="sm" icon="close" @click="removeFilterRow(i)" />
            </div>
            <div v-if="row.attribute" class="value-box">
              <span v-if="row.loading" class="hint">Loading values…</span>
              <span v-else-if="!row.values.length" class="hint">No values found for this attribute on the selected step type(s).</span>
              <template v-else>
                <span class="hint">Detected values — tick the ones to include:</span>
                <div class="chip-select">
                  <button
                    v-for="v in row.values"
                    :key="v.value"
                    type="button"
                    class="chip"
                    :class="{ on: row.selected.has(v.value) }"
                    @click="toggleFilterRowValue(row, v.value)"
                  >
                    {{ v.value }}<span class="n">{{ v.count }}</span>
                  </button>
                </div>
              </template>
            </div>
          </div>
          <q-btn outline no-caps dense size="sm" label="+ Add filter" :disable="selectedStepTypes.size === 0" @click="addFilterRow" />
        </div>
      </div>

      <div class="actions">
        <q-btn unelevated no-caps color="primary" label="Preview" :disable="selectedStepTypes.size === 0" :loading="previewLoading" @click="runPreview" />
        <q-btn outline no-caps label="Clear" @click="resetBuilder" />
        <div class="save-row" :class="{ highlight: previewResult && !newChartName.trim() }">
          <div class="save-field">
            <label>Chart name (required to save)</label>
            <input v-model="newChartName" class="text-input" placeholder="e.g. Guardrail blocks per day" :disabled="!previewResult" />
          </div>
          <q-btn outline no-caps color="primary" label="Save to Metrics" :disable="!previewResult || !newChartName.trim()" :loading="saving" @click="saveChart" />
        </div>
      </div>
      <p v-if="previewResult && !newChartName.trim()" class="hint save-hint">↑ Type a name above to enable "Save to Metrics"</p>

      <p v-if="previewError" class="error-text">{{ previewError }}</p>

      <div v-if="previewResult" class="preview">
        <div v-if="chartType === 'number'" class="number-tile">{{ previewTotal.toLocaleString() }}</div>
        <table v-else-if="chartType === 'table'" class="result-table">
          <thead><tr><th>{{ groupByAttribute || "Step type" }}</th><th>{{ METRICS.find((m) => m.value === metric)?.label }}</th></tr></thead>
          <tbody><tr v-for="p in previewResult.points" :key="p.label"><td>{{ p.label }}</td><td>{{ p.value.toLocaleString() }}</td></tr></tbody>
        </table>
        <EChart v-else-if="previewOption" :option="previewOption" height="220px" label="Custom chart preview" />
        <p v-if="!previewResult.points.length && !previewResult.timeseries.length" class="hint">No data for this combination in the selected range.</p>
      </div>
    </div>

    <div v-if="saved.length || savedLoading" class="saved-section">
      <div class="saved-section-head">
        <h4>Saved charts</h4>
        <span class="panel-count">{{ saved.length }}</span>
      </div>
      <div class="saved-list">
        <div v-for="m in saved" :key="m.id" class="saved-card">
          <div class="saved-head">
            <span class="name">{{ m.name }}</span>
            <q-btn flat dense no-caps size="sm" icon="close" @click="removeSaved(m.id)" />
          </div>
          <div v-if="savedResults[m.id]" class="saved-chart">
            <div v-if="m.definition.chartType === 'number'" class="number-tile small">
              {{ (savedResults[m.id]?.points.reduce((s, p) => s + p.value, 0) ?? 0).toLocaleString() }}
            </div>
            <table v-else-if="m.definition.chartType === 'table'" class="result-table">
              <thead><tr><th>{{ m.definition.groupByAttribute || "Step type" }}</th><th>{{ METRICS.find((x) => x.value === m.definition.metric)?.label }}</th></tr></thead>
              <tbody><tr v-for="p in savedResults[m.id]!.points" :key="p.label"><td>{{ p.label }}</td><td>{{ p.value.toLocaleString() }}</td></tr></tbody>
            </table>
            <EChart v-else :option="optionFor(savedResults[m.id]!, m.definition.chartType)" height="180px" :label="m.name" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.detail-panel {
  padding: 28px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
}
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--mt-line);
}
.panel-header h3 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.01em;
}
.custom-charts {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.panel-hint {
  display: block;
  font-size: 12.5px;
  color: var(--mt-muted);
}
.builder {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.builder-step {
  display: flex;
  gap: 20px;
  padding: 20px 0;
  border-bottom: 1px solid var(--mt-line-2);
}
.builder-step:first-child {
  padding-top: 0;
}
.step-head {
  flex: 0 0 200px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.step-num {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
}
.step-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.01em;
}
.step-caption {
  display: block;
  font-size: 11.5px;
  color: var(--mt-muted);
  margin-top: 2px;
}
.step-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.field {
  flex: 1 1 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field.full {
  flex: 1 1 100%;
}
.field label {
  font-size: 11.5px;
  color: var(--mt-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--mt-radius-sm, 8px);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
  transition: border-color 0.15s ease;
}
.text-input:hover {
  border-color: var(--mt-muted);
}
.text-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
  border-color: var(--mt-accent);
}
select.text-input {
  cursor: pointer;
}
.hint {
  font-size: 11.5px;
  color: var(--mt-muted);
}
.type-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.type-btn,
.chip {
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  border-radius: var(--mt-radius-sm, 8px);
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.type-btn {
  padding: 8px 14px;
  font-size: 12.5px;
  font-weight: 600;
}
.type-btn:hover {
  border-color: var(--mt-muted);
}
.type-btn.on {
  background: var(--mt-accent);
  border-color: var(--mt-accent);
  color: var(--mt-accent-ink, #fff);
}
.chip-select {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm, 8px);
  padding: 10px;
  min-height: 40px;
  background: var(--mt-card);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  font-weight: 500;
  padding: 4px 9px 4px 6px;
  background: var(--mt-soft);
}
.chip:hover {
  border-color: var(--mt-muted);
}
.chip .n {
  color: var(--mt-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.chip.on {
  background: var(--mt-accent);
  border-color: var(--mt-accent);
  color: var(--mt-accent-ink, #fff);
}
.chip.on .n {
  color: inherit;
  opacity: 0.8;
}
.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.filter-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 14px;
  margin-bottom: 4px;
  border-bottom: 1px dashed var(--mt-line-2);
}
.filter-block:last-of-type {
  border-bottom: none;
  padding-bottom: 6px;
}
.filter-block .filter-row select {
  flex: 1;
}
.axis-summary {
  margin: 2px 0 0;
  padding: 8px 12px;
  background: var(--mt-soft);
  border-radius: var(--mt-radius-sm, 8px);
}
.result-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.result-table th,
.result-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--mt-line-2);
}
.result-table th {
  color: var(--mt-muted);
  font-weight: 600;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.value-box {
  border: 1px solid var(--mt-line-2);
  border-radius: var(--mt-radius-sm, 8px);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 20px;
}
.save-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-left: auto;
  padding: 6px 10px;
  border-radius: var(--mt-radius-sm, 8px);
  transition: background 0.2s ease, box-shadow 0.2s ease;
}
.save-row.highlight {
  background: color-mix(in srgb, var(--mt-accent) 10%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--mt-accent) 35%, transparent);
}
.save-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.save-field label {
  font-size: 11px;
  font-weight: 700;
  color: var(--mt-accent);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.save-row .text-input {
  width: 240px;
}
.save-hint {
  margin: -4px 0 0;
  color: var(--mt-accent);
  font-weight: 600;
}
.error-text {
  font-size: 12.5px;
  color: var(--mt-err-ink);
  margin: 0;
}
.preview {
  margin-top: 4px;
  padding: 20px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg, 10px);
  background: var(--mt-soft);
}
.number-tile {
  font-size: 44px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  padding: 10px 4px;
  color: var(--mt-accent);
}
.number-tile.small {
  font-size: 28px;
  padding: 4px;
}
.saved-section {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--mt-line);
}
.saved-section-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.saved-section-head h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--mt-ink);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.saved-section-head .panel-count {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-muted);
}
.saved-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.saved-card {
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg, 10px);
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.saved-card:hover {
  border-color: var(--mt-muted);
  box-shadow: var(--mt-shadow);
}
.saved-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.saved-head .name {
  font-size: 13px;
  font-weight: 600;
  color: var(--mt-ink);
}
</style>
