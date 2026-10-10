<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "./Select.vue";
import type { ChartCatalogEntryDto, CustomMetricDefinitionDto, CustomMetricPointDto } from "@contract";
import type { EChartsCoreOption } from "echarts/core";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { customMetricChartOption, presentResult } from "../custom-metric-chart-option";
import EChart from "./EChart.vue";
import ChartCatalogEditor from "./ChartCatalogEditor.vue";
import { usePermissions } from "../composables/usePermissions";
import { isAttributeShown, isMeasure, type AttributeInfo, type Visibility } from "@/domain/attribute-visibility";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import type { SavedCustomMetricDto } from "@/application/identity-api";
import type { RangeParams } from "@/application/trace-api";
import {
  ATTRIBUTE_METRICS,
  METRIC_LABELS,
  SELECTABLE_METRICS,
  isAttributeMetric,
  metricColumnLabel,
  attributeLabel,
  buildNames,
  describeChange,
  describeDefinition,
  findOutlier,
  formatMetricValue,
  previousRange,
  singleNumber,
  stepLabel,
  suggestChartType,
  suggestName,
  templatesFor,
  type ChartTemplate,
} from "@/domain/custom-chart-vocabulary";
import Button from "./Button.vue";
import ToggleChip from "./ToggleChip.vue";
import SegmentedControl from "./SegmentedControl.vue";

const props = defineProps<{ experimentId: string; range: RangeParams }>();

const api = useTraceApi();
const identityApi = useIdentityApi();
const $q = useQuasar();
const { can } = usePermissions();

// ---- nombres de negocio editados en el catálogo (ADR-078): tienen prioridad sobre el diccionario y lo humanizado ----
const catalogEntries = ref<ChartCatalogEntryDto[]>([]);
const names = computed(() => buildNames(catalogEntries.value));
const showCatalog = ref(false);
async function loadCatalog() {
  try {
    catalogEntries.value = await identityApi.listChartCatalog(props.experimentId);
  } catch {
    // sin catálogo las gráficas siguen funcionando con los nombres automáticos
    catalogEntries.value = [];
  }
}

type Result = { points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] };

// ---- descubrimiento (ADR-027): lo que hay en las trazas del usuario, presentado con nombres de negocio (ADR-057) ----
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
const templates = computed(() => templatesFor(stepKinds.value.map((s) => s.stepType), names.value));
const QUESTIONS_COLLAPSED = 6;
const showAllQuestions = ref(false);
const questionsOpen = ref(false);
const visibleQuestions = computed(() => (showAllQuestions.value ? templates.value : templates.value.slice(0, QUESTIONS_COLLAPSED)));

// ---- estado del builder ----
const chartType = ref<CustomMetricDefinitionDto["chartType"]>("line");
const chartTypeTouched = ref(false);
const selectedSteps = ref<string[]>([]);
const hasSteps = computed(() => selectedSteps.value.length > 0);
/** Desglose y condiciones solo tienen sentido sobre un único paso: con varios, la gráfica compara un paso por serie. */
const singleStep = computed(() => (selectedSteps.value.length === 1 ? selectedSteps.value[0]! : ""));
const multiStep = computed(() => selectedSteps.value.length > 1);
const metric = ref<CustomMetricDefinitionDto["metric"]>("count");
/** el número que miden las métricas sobre un atributo (ADR-078, fase 3) */
const metricAttribute = ref("");
const groupByAttribute = ref("");
const showTechnical = ref(false);
const activeTemplate = ref<string | null>(null);

const attributeKeys = ref<AttributeInfo[]>([]);
const attributeKeysLoading = ref(false);

async function loadAttributeKeys() {
  attributeKeys.value = [];
  if (!singleStep.value) return;
  attributeKeysLoading.value = true;
  try {
    const { items } = await api.getAttributeKeys({ ...props.range, stepTypes: [singleStep.value] });
    attributeKeys.value = items;
    // el número elegido pudo no existir en este paso o rango: se vuelve a contar en vez de medir algo que no hay
    if (isAttributeMetric(metric.value) && !items.some((k) => k.key === metricAttribute.value && isMeasure(k))) resetMeasure();
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
}
async function loadFilterRowValues(row: FilterRow) {
  row.values = [];
  row.selected = new Set();
  if (!row.attribute || !singleStep.value) return;
  row.loading = true;
  try {
    const { items } = await api.getAttributeValues({ ...props.range, stepTypes: [singleStep.value], attribute: row.attribute });
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
}

/** Vuelve a contar: una métrica sobre un número solo vale para un paso concreto y un número que exista en él. */
function resetMeasure() {
  metric.value = "count";
  metricAttribute.value = "";
}

function toggleStep(id: string) {
  activeTemplate.value = null;
  if (isAttributeMetric(metric.value)) resetMeasure();
  selectedSteps.value = selectedSteps.value.includes(id) ? selectedSteps.value.filter((x) => x !== id) : [...selectedSteps.value, id];
  groupByAttribute.value = "";
  filterRows.value = [];
  void loadAttributeKeys();
}

function pickChartType(t: CustomMetricDefinitionDto["chartType"]) {
  chartType.value = t;
  chartTypeTouched.value = true;
}

async function applyTemplate(t: ChartTemplate) {
  const d = t.definition;
  activeTemplate.value = t.id;
  selectedSteps.value = [...d.stepTypes];
  metric.value = d.metric;
  metricAttribute.value = d.metricAttribute ?? "";
  groupByAttribute.value = d.groupByAttribute ?? "";
  chartType.value = d.chartType;
  chartTypeTouched.value = true;
  filterRows.value = [];
  nameTouched.value = false;
  newChartName.value = suggestName(currentDefinition(), names.value);
  await loadAttributeKeys();
}

function currentDefinition(): CustomMetricDefinitionDto {
  return {
    chartType: chartType.value,
    stepTypes: [...selectedSteps.value],
    metric: metric.value,
    metricAttribute: isAttributeMetric(metric.value) ? metricAttribute.value || null : null,
    groupByAttribute: groupByAttribute.value.trim() || null,
    filters: filterRows.value
      .filter((r) => r.attribute && r.selected.size > 0)
      .map((r) => ({ attribute: r.attribute, values: [...r.selected] })),
  };
}

const description = computed(() => describeDefinition(currentDefinition(), names.value));

// ---- nombre sugerido: se rellena solo hasta que la persona lo edita ----
const newChartName = ref("");
const nameTouched = ref(false);
watch(
  () => suggestName(currentDefinition(), names.value),
  (suggested) => {
    if (!nameTouched.value && hasSteps.value) newChartName.value = suggested;
  },
);

// ---- el tipo de gráfica se sugiere solo hasta que la persona elige uno ----
watch(selectedSteps, () => {
  groupByAttribute.value = "";
  filterRows.value = [];
  void loadAttributeKeys();
});
watch(groupByAttribute, (g) => {
  if (!chartTypeTouched.value) chartType.value = suggestChartType(g || null);
});

// ---- vista previa en vivo ----
const previewResult = ref<Result | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewSeq = 0;

async function runPreview() {
  const seq = ++previewSeq;
  // una métrica sobre un número sin número elegido todavía no se puede calcular
  if (!hasSteps.value || (isAttributeMetric(metric.value) && !metricAttribute.value)) {
    previewResult.value = null;
    summary.value = null;
    previewLoading.value = false;
    return;
  }
  previewLoading.value = true;
  previewError.value = null;
  try {
    const res = await api.queryCustomMetric(currentDefinition(), props.range);
    if (seq === previewSeq) {
      previewResult.value = res;
      void runSummary(seq);
    }
  } catch (err) {
    if (seq !== previewSeq) return;
    previewError.value = err instanceof Error ? err.message : "Could not compute the chart";
    previewResult.value = null;
  } finally {
    if (seq === previewSeq) previewLoading.value = false;
  }
}

// ---- cifra global y comparación con el periodo anterior (sin desglose, para que la cifra sea el total real) ----
const summary = ref<{ current: number; previous: number } | null>(null);

async function runSummary(seq: number) {
  summary.value = null;
  const def: CustomMetricDefinitionDto = { ...currentDefinition(), groupByAttribute: null, chartType: "number" };
  try {
    const [cur, prev] = await Promise.all([api.queryCustomMetric(def, props.range), api.queryCustomMetric(def, previousRange(props.range))]);
    if (seq !== previewSeq) return;
    summary.value = { current: singleNumber(metric.value, cur.points), previous: singleNumber(metric.value, prev.points) };
  } catch {
    if (seq === previewSeq) summary.value = null;
  }
}

watch(
  () => JSON.stringify(currentDefinition()),
  () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void runPreview(), 300);
  },
);
onBeforeUnmount(() => clearTimeout(previewTimer));

function resetBuilder() {
  selectedSteps.value = [];
  activeTemplate.value = null;
  metric.value = "count";
  metricAttribute.value = "";
  groupByAttribute.value = "";
  chartType.value = "line";
  chartTypeTouched.value = false;
  filterRows.value = [];
  attributeKeys.value = [];
  previewResult.value = null;
  summary.value = null;
  previewError.value = null;
  newChartName.value = "";
  nameTouched.value = false;
}

// ---- opciones de ECharts a partir del resultado (compartido con MetricReportView, ADR-035) ----
const present = (result: Parameters<typeof presentResult>[0], def: Parameters<typeof presentResult>[1]) => presentResult(result, def, names.value);
function optionFor(result: Result, def: Pick<CustomMetricDefinitionDto, "groupByAttribute" | "metric">, type: CustomMetricDefinitionDto["chartType"]): EChartsCoreOption {
  return customMetricChartOption(present(result, def), type, $q.dark.isActive, def.metric);
}

const previewOption = computed(() =>
  previewResult.value && chartType.value !== "table" && chartType.value !== "number" ? optionFor(previewResult.value, currentDefinition(), chartType.value) : null,
);
const previewRows = computed(() => (previewResult.value ? present(previewResult.value, currentDefinition()).points : []));
const headline = computed(() => {
  if (!summary.value || (multiStep.value && metric.value !== "count")) return null;
  const { current, previous } = summary.value;
  return {
    value: formatMetricValue(metric.value, current),
    previous: formatMetricValue(metric.value, previous),
    change: describeChange(metric.value, current, previous),
    overall: !!groupByAttribute.value,
  };
});
const outlier = computed(() => (groupByAttribute.value ? findOutlier(metric.value, previewRows.value) : null));

// ---- guardados ----
const saved = ref<SavedCustomMetricDto[]>([]);
const savedResults = reactive<Record<string, Result | null>>({});
const savedLoading = ref(false);
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
  if (!newChartName.value.trim() || !hasSteps.value) return;
  saving.value = true;
  try {
    await identityApi.createCustomMetric(props.experimentId, newChartName.value.trim(), currentDefinition());
    resetBuilder();
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
watch(() => props.experimentId, () => { void loadSaved(); void loadCatalog(); }, { immediate: true });

const CHART_TYPES: { value: CustomMetricDefinitionDto["chartType"]; label: string }[] = [
  { value: "line", label: "Over time" },
  { value: "bar", label: "Bars" },
  { value: "pie", label: "Pie" },
  { value: "area", label: "Area" },
  { value: "number", label: "Single number" },
  { value: "table", label: "Table" },
];
/** "Based on 1,284 tool calls": cuántos datos hay detrás de cada pregunta. */
function templateBasis(t: ChartTemplate): string {
  const n = stepKinds.value.filter((s) => t.requires.includes(s.stepType)).reduce((sum, s) => sum + s.count, 0);
  return `Based on ${n.toLocaleString()} ${stepLabel(t.requires[0] ?? "", names.value).toLowerCase()}`;
}
/** Los números de este paso que se pueden medir. Con varios pasos no hay una lista común: la medida pide un único paso. */
const measureAttributes = computed(() => (singleStep.value ? attributeKeys.value.filter(isMeasure) : []));
const METRICS = computed(() => [
  ...SELECTABLE_METRICS.map((value) => ({ value, label: METRIC_LABELS[value] })),
  ...(measureAttributes.value.length > 0 ? ATTRIBUTE_METRICS.map((value) => ({ value, label: METRIC_LABELS[value] })) : []),
]);
const measureOptions = computed(() => measureAttributes.value.map((k) => ({ label: attributeLabel(k.key, names.value), value: k.key })));
// al elegir una métrica sobre un número se propone el primero, para que la gráfica se calcule sin un paso más
watch(metric, (m) => {
  if (isAttributeMetric(m) && !metricAttribute.value && measureAttributes.value[0]) metricAttribute.value = measureAttributes.value[0].key;
  if (!isAttributeMetric(m)) metricAttribute.value = "";
});
const metricLabel = (def: { metric: CustomMetricDefinitionDto["metric"]; metricAttribute?: string | null }) => metricColumnLabel(def, names.value);

/** Lo que la persona decidió en el catálogo para un atributo: forzar que se vea, que se oculte, o dejarlo a la clasificación. */
const visibilityOf = (key: string): Visibility => catalogEntries.value.find((e) => e.kind === "attribute" && e.key === key)?.visibility ?? "auto";

/**
 * Los selectores ofrecen las categorías y las medidas; esconden los ids, los textos libres y los detalles técnicos (ADR-078) salvo que
 * la persona lo pida, los fuerce desde el catálogo o ya estén elegidos en la gráfica.
 */
const visibleAttributeKeys = computed(() =>
  attributeKeys.value.filter(
    (k) => showTechnical.value || isAttributeShown(k, visibilityOf(k.key)) || k.key === groupByAttribute.value || filterRows.value.some((r) => r.attribute === k.key),
  ),
);
const hiddenTechnicalCount = computed(() => attributeKeys.value.length - visibleAttributeKeys.value.length);
const groupByOptions = computed(() => [
  { label: "— don't break down —", value: "" },
  ...visibleAttributeKeys.value.map((k) => ({ label: attributeLabel(k.key, names.value), value: k.key })),
]);
const filterAttributeOptions = computed(() => [
  { label: "Choose a detail…", value: "" },
  ...visibleAttributeKeys.value.map((k) => ({ label: attributeLabel(k.key, names.value), value: k.key })),
]);
const groupHeader = (def: Pick<CustomMetricDefinitionDto, "groupByAttribute">) => (def.groupByAttribute ? attributeLabel(def.groupByAttribute, names.value) : "Step");
</script>

<template>
  <section class="detail-panel custom-charts">
    <div class="panel-header">
      <div>
        <h3>Custom charts</h3>
        <span class="panel-hint">Pick a question, or build your own chart — no query language required.</span>
      </div>
    </div>

    <div class="cc-grid">
      <div class="cc-builder">
        <template v-if="templates.length && !hasSteps">
          <div class="cc-title">What do you want to know?</div>
          <p class="hint cc-sub">Pick a question. We set up the chart; you can tweak it after.</p>
          <div class="question-list">
            <button v-for="t in visibleQuestions" :key="t.id" type="button" class="question-card" @click="applyTemplate(t)">
              <span class="q-text">{{ t.question }}</span>
              <span class="q-basis">{{ templateBasis(t) }}</span>
            </button>
          </div>
          <Button class="self-start" variant="link" v-if="templates.length > QUESTIONS_COLLAPSED" @click="showAllQuestions = !showAllQuestions">
            {{ showAllQuestions ? "Show fewer questions" : `Show all ${templates.length} questions` }}
          </Button>
          <div class="cc-divider" />
          <div class="eyebrow">Or build it yourself</div>
        </template>

        <div class="field">
          <label>I want to see… <span class="label-note">(pick one or several to compare)</span>
            <Button variant="link" v-if="can('catalog:manage')" data-testid="open-catalog" @click="showCatalog = true" class="rename">Rename things</Button>
          </label>
          <div class="chip-select">
            <span v-if="stepKindsLoading" class="hint">Loading…</span>
            <span v-else-if="!stepKinds.length" class="hint">No activity in this range yet.</span>
            <ToggleChip v-for="k in stepKinds" :key="k.stepType" :pressed="selectedSteps.includes(k.stepType)" :count="k.count.toLocaleString()" @click="toggleStep(k.stepType)">{{ stepLabel(k.stepType, names) }}</ToggleChip>
          </div>
        </div>
        <ChartCatalogEditor v-if="showCatalog" :experiment-id="experimentId" :range="range" :entries="catalogEntries" @close="showCatalog = false" @changed="catalogEntries = $event" />
        <div class="field">
          <label>Measured as…</label>
          <Select v-model="metric" :options="METRICS" :disabled="!hasSteps" data-testid="metric-select" />
          <template v-if="isAttributeMetric(metric)">
            <label class="sub-label">Of which number?</label>
            <Select v-model="metricAttribute" :options="measureOptions" data-testid="measure-select" />
          </template>
          <span v-else-if="singleStep && !measureAttributes.length && !attributeKeysLoading" class="hint" data-testid="no-measures">This step has no numbers to add up or average.</span>
        </div>
        <div class="field">
          <label>Split by… (optional)</label>
          <Select v-model="groupByAttribute" :options="groupByOptions" :disabled="!singleStep" />
          <span v-if="attributeKeysLoading" class="hint">Loading details…</span>
          <span v-else-if="multiStep" class="hint">Comparing {{ selectedSteps.length }} steps: one {{ chartType === "line" || chartType === "area" ? "line" : "bar" }} each. Pick a single step to split it by a detail.</span>
          <span v-else-if="singleStep && !visibleAttributeKeys.length" class="hint">Nothing to split by for this step.</span>
          <Button class="self-start" variant="link" v-if="singleStep && (hiddenTechnicalCount > 0 || showTechnical)" @click="showTechnical = !showTechnical">
            {{ showTechnical ? "Show fewer details" : `Show ${hiddenTechnicalCount} more detail${hiddenTechnicalCount === 1 ? "" : "s"}` }}
          </Button>
        </div>

        <div class="field">
          <label>Only when… (optional)</label>
          <div v-for="(row, i) in filterRows" :key="i" class="filter-block">
            <div class="filter-row">
              <Select v-model="row.attribute" :options="filterAttributeOptions" :disabled="!singleStep" @update:model-value="loadFilterRowValues(row)" />
              <Button variant="icon" size="sm" aria-label="Remove condition" @click="removeFilterRow(i)"><q-icon name="close" size="16px" /></Button>
            </div>
            <div v-if="row.attribute" class="value-box">
              <span v-if="row.loading" class="hint">Loading values…</span>
              <span v-else-if="!row.values.length" class="hint">No values found for this detail.</span>
              <template v-else>
                <span class="hint">Only include these:</span>
                <div class="chip-select">
                  <ToggleChip v-for="v in row.values" :key="v.value" :pressed="row.selected.has(v.value)" :count="v.count" @click="toggleFilterRowValue(row, v.value)">{{ v.value }}</ToggleChip>
                </div>
              </template>
            </div>
          </div>
          <div>
            <Button variant="link" class="add-condition" :disabled="!singleStep" @click="addFilterRow">+ Add condition</Button>
          </div>
        </div>

        <template v-if="templates.length && hasSteps">
          <div class="cc-divider" />
          <Button class="self-start" variant="link" @click="questionsOpen = !questionsOpen">
            {{ questionsOpen ? "Hide questions" : `Try another question (${templates.length})` }}
          </Button>
          <div v-if="questionsOpen" class="pill-row">
            <ToggleChip v-for="t in templates" :key="t.id" :pressed="activeTemplate === t.id" @click="applyTemplate(t)">{{ t.question }}</ToggleChip>
          </div>
        </template>
      </div>

      <div class="cc-preview-card" :class="{ empty: !hasSteps }">
        <template v-if="!hasSteps">
          <div class="ghost" aria-hidden="true">
            <div v-for="w in [200, 150, 110, 60]" :key="w" class="ghost-row"><span class="ghost-label" /><span class="ghost-bar" :style="{ width: w + 'px' }" /></div>
          </div>
          <div class="cc-title">Your chart appears here</div>
          <p class="hint cc-sub">Choose a question on the left and you will see the result right away, computed from your traces.</p>
        </template>

        <template v-else>
          <div class="preview-head">
            <div class="preview-name">
              <TextInput v-model="newChartName" placeholder="Name this chart" @update:model-value="nameTouched = true" />
              <span class="hint">{{ description }}</span>
            </div>
            <SegmentedControl class="seg" aria-label="Chart type" :options="CHART_TYPES.map((t) => ({ value: t.value, label: t.label, class: 'seg-btn' }))" :model-value="chartType" @update:model-value="pickChartType($event as typeof chartType)" />
          </div>

          <div class="preview-body" :class="{ stale: previewLoading }">
            <p v-if="previewError" class="error-text">{{ previewError }}</p>

            <div v-if="headline" class="headline">
              <span class="headline-value">{{ headline.value }}</span>
              <span v-if="headline.change" class="delta" :class="headline.change.tone">{{ headline.change.label }}</span>
              <span class="hint">{{ headline.overall ? "overall" : "" }}{{ headline.overall && headline.change ? " · " : "" }}{{ headline.change ? `vs previous period (${headline.previous})` : "" }}</span>
            </div>

            <template v-if="previewResult">
              <table v-if="chartType === 'table'" class="result-table">
                <thead><tr><th>{{ groupHeader({ groupByAttribute: groupByAttribute || null }) }}</th><th>{{ metricLabel({ metric, metricAttribute }) }}</th></tr></thead>
                <tbody><tr v-for="p in previewRows" :key="p.label"><td>{{ p.label }}</td><td>{{ formatMetricValue(metric, p.value) }}</td></tr></tbody>
              </table>
              <EChart v-else-if="previewOption" :option="previewOption" height="240px" label="Custom chart preview" />
              <p v-if="!previewResult.points.length && !previewResult.timeseries.length" class="hint">No data for this combination in the selected range.</p>
            </template>
            <p v-else-if="!previewError" class="hint">Loading…</p>

            <div v-if="outlier" class="insight">
              <q-icon name="warning_amber" size="18px" />
              <span><b>{{ outlier.label }}</b> {{ outlier.text }}</span>
            </div>
          </div>

          <div class="preview-foot">
            <span class="hint foot-hint">{{ chartTypeTouched ? "" : "Chart type suggested for this data. Change it any time." }}</span>
            <Button @click="resetBuilder">Start over</Button>
            <Button variant="primary" :disabled="!previewResult || !newChartName.trim()" :loading="saving" @click="saveChart">Save to Metrics</Button>
          </div>
        </template>
      </div>
    </div>

    <div class="saved-section">
      <div class="saved-section-head">
        <h4>Saved charts</h4>
        <span class="panel-count">{{ saved.length }}</span>
      </div>
      <p v-if="!saved.length && !savedLoading" class="hint">Charts you save show up here and refresh with the selected period.</p>
      <div v-else class="saved-list">
        <div v-for="m in saved" :key="m.id" class="saved-card">
          <div class="saved-head">
            <span class="name">{{ m.name }}</span>
            <Button variant="icon" size="sm" :aria-label="`Delete ${m.name}`" @click="removeSaved(m.id)"><q-icon name="close" size="16px" /></Button>
          </div>
          <div v-if="savedResults[m.id]" class="saved-chart">
            <div v-if="m.definition.chartType === 'number'" class="number-tile small">
              {{ formatMetricValue(m.definition.metric, singleNumber(m.definition.metric, savedResults[m.id]?.points ?? [])) }}
            </div>
            <table v-else-if="m.definition.chartType === 'table'" class="result-table">
              <thead><tr><th>{{ groupHeader(m.definition) }}</th><th>{{ metricLabel(m.definition) }}</th></tr></thead>
              <tbody><tr v-for="p in present(savedResults[m.id]!, m.definition).points" :key="p.label"><td>{{ p.label }}</td><td>{{ formatMetricValue(m.definition.metric, p.value) }}</td></tr></tbody>
            </table>
            <EChart v-else :option="optionFor(savedResults[m.id]!, m.definition, m.definition.chartType)" height="180px" :label="m.name" />
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
.field {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field label {
  font-size: 11.5px;
  color: var(--mt-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.hint {
  font-size: 11.5px;
  color: var(--mt-muted);
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
.error-text {
  font-size: 12.5px;
  color: var(--mt-err-ink);
  margin: 0;
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

.cc-grid {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
}
@media (max-width: 1000px) {
  .cc-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.cc-builder,
.cc-preview-card {
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg, 10px);
  background: var(--mt-card);
}
.cc-builder {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cc-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--mt-ink);
}
.label-note {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--mt-muted);
}
.cc-sub {
  margin: 0;
}
.cc-divider {
  height: 1px;
  background: var(--mt-line-2);
}
.eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.question-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.question-card,
.pill {
  font-family: inherit;
  cursor: pointer;
  color: var(--mt-ink);
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  transition: border-color 0.15s ease, background 0.15s ease;
}
.question-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--mt-radius-sm, 8px);
}
.question-card:hover,
.pill:hover {
  border-color: var(--mt-muted);
}
.q-text {
  font-size: 13px;
  font-weight: 700;
}
.q-basis {
  font-size: 11.5px;
  color: var(--mt-muted);
}
.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cc-preview-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.cc-preview-card.empty {
  border-style: dashed;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 24px;
  min-height: 360px;
  text-align: center;
}
.ghost {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
  opacity: 0.55;
}
.ghost-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ghost-label {
  width: 64px;
  height: 10px;
  border-radius: 5px;
  background: var(--mt-line);
}
.ghost-bar {
  height: 18px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--mt-accent) 25%, transparent);
}
.preview-head {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--mt-line-2);
}
.preview-name {
  flex: 1 1 260px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-body {
  padding: 16px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: opacity 0.15s ease;
}
.preview-body.stale {
  opacity: 0.6;
}
.headline {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.headline-value {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.delta {
  align-self: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 800;
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.delta.bad {
  background: var(--mt-err-bg, #ffe4e9);
  color: var(--mt-err-ink);
}
.delta.good {
  background: var(--mt-ok-bg, #dcfce7);
  color: var(--mt-ok-ink, #15803d);
}
.insight {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--mt-radius-sm, 8px);
  background: var(--mt-warn-bg, #fef3c7);
  color: var(--mt-warn-ink, #92400e);
  font-size: 13px;
}
.preview-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--mt-line-2);
  border-radius: 0 0 var(--mt-radius-lg, 10px) var(--mt-radius-lg, 10px);
  background: var(--mt-soft);
}
.foot-hint {
  flex: 1;
}
.self-start { align-self: flex-start; }
</style>
