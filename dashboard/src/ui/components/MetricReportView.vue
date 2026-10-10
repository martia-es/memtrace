<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import type { CustomMetricDefinitionDto, CustomMetricPointDto } from "@contract";
import { computed, reactive, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { GridItem, GridLayout } from "grid-layout-plus";
import EChart from "./EChart.vue";
import EmptyState from "./EmptyState.vue";
import ErrorBanner from "./ErrorBanner.vue";
import { customMetricChartOption, presentResult } from "../custom-metric-chart-option";
import { NO_NAMES, buildNames, formatMetricValue, singleNumber, type NameCatalog } from "@/domain/custom-chart-vocabulary";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import type { MetricReportDto, SavedCustomMetricDto } from "@/application/identity-api";
import type { RangeParams } from "@/application/trace-api";
import Button from "./Button.vue";
import LoadingState from "./LoadingState.vue";
import Spinner from "./Spinner.vue";
import Modal from "./Modal.vue";

const props = defineProps<{ experimentId: string; reportId: string; range: RangeParams }>();
const emit = defineEmits<{ renamed: [name: string]; deleted: [] }>();

const identityApi = useIdentityApi();
const api = useTraceApi();
const $q = useQuasar();

interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const report = ref<MetricReportDto | null>(null);
const loading = ref(false);
const loadError = ref<Error | null>(null);
const layout = ref<LayoutItem[]>([]);

function syncLayoutFromReport() {
  layout.value = (report.value?.charts ?? []).map((c) => ({ i: c.customMetricId, x: c.x, y: c.y, w: c.w, h: c.h }));
}

async function loadReport() {
  loading.value = true;
  loadError.value = null;
  try {
    report.value = await identityApi.getMetricReport(props.experimentId, props.reportId);
    syncLayoutFromReport();
    // Un informe recién creado no tiene charts: entra directo en modo edición para que el usuario
    // vea el selector de "añadir gráfico guardado" sin un paso extra (feedback de usuario, ADR-035).
    if (!layout.value.length) await enterEdit();
  } catch (err) {
    loadError.value = err instanceof Error ? err : new Error("Could not load the report");
  } finally {
    loading.value = false;
  }
}
watch(() => props.reportId, loadReport, { immediate: true });

type ChartResult = { points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] };
const results = reactive<Record<string, ChartResult | null>>({});

// nombres de negocio del catálogo (ADR-078): el informe habla igual que el builder
const names = ref<NameCatalog>(NO_NAMES);
async function loadNames() {
  try {
    names.value = buildNames(await identityApi.listChartCatalog(props.experimentId));
  } catch {
    names.value = NO_NAMES;
  }
}

async function loadResultFor(id: string, definition: CustomMetricDefinitionDto) {
  try {
    results[id] = presentResult(await api.queryCustomMetric(definition, props.range), definition, names.value);
  } catch {
    results[id] = null;
  }
}

async function loadAllResults() {
  if (!report.value) return;
  await loadNames();
  await Promise.all(report.value.charts.map((c) => loadResultFor(c.customMetricId, c.definition)));
}
watch([report, () => props.range], loadAllResults);

function optionFor(result: ChartResult, type: CustomMetricDefinitionDto["chartType"], metric: CustomMetricDefinitionDto["metric"]) {
  return customMetricChartOption(result, type, $q.dark.isActive, metric);
}

// ---- modo edición: añadir/quitar charts ya guardados y mover/redimensionar el grid (ADR-035) ----
const editMode = ref(false);
const availableCharts = ref<SavedCustomMetricDto[]>([]);
const savingLayout = ref(false);

async function enterEdit() {
  editMode.value = true;
  availableCharts.value = await identityApi.listCustomMetrics(props.experimentId);
}

function cancelEdit() {
  editMode.value = false;
  syncLayoutFromReport();
}

const chartById = computed(() => {
  const map = new Map<string, { name: string; definition: CustomMetricDefinitionDto }>();
  for (const c of report.value?.charts ?? []) map.set(c.customMetricId, { name: c.name, definition: c.definition });
  for (const m of availableCharts.value) if (!map.has(m.id)) map.set(m.id, { name: m.name, definition: m.definition });
  return map;
});

const chartsNotInLayout = computed(() => availableCharts.value.filter((m) => !layout.value.some((l) => l.i === m.id)));

function addChart(metric: SavedCustomMetricDto) {
  const maxY = layout.value.reduce((max, l) => Math.max(max, l.y + l.h), 0);
  layout.value = [...layout.value, { i: metric.id, x: 0, y: maxY, w: 6, h: 4 }];
  if (!(metric.id in results)) void loadResultFor(metric.id, metric.definition);
}

function removeFromLayout(id: string) {
  layout.value = layout.value.filter((l) => l.i !== id);
}

async function saveLayout() {
  savingLayout.value = true;
  try {
    report.value = await identityApi.setMetricReportCharts(
      props.experimentId,
      props.reportId,
      layout.value.map((l) => ({ customMetricId: l.i, x: l.x, y: l.y, w: l.w, h: l.h })),
    );
    syncLayoutFromReport();
    editMode.value = false;
  } finally {
    savingLayout.value = false;
  }
}

// ---- renombrar / borrar el informe ----
const renaming = ref(false);
const renameValue = ref("");
async function saveRename() {
  if (!renameValue.value.trim() || !report.value) return;
  report.value = await identityApi.renameMetricReport(props.experimentId, props.reportId, renameValue.value.trim());
  renaming.value = false;
  emit("renamed", report.value.name);
}

const confirmingDelete = ref(false);
async function confirmDelete() {
  await identityApi.deleteMetricReport(props.experimentId, props.reportId);
  confirmingDelete.value = false;
  emit("deleted");
}

// ---- enviar por email (ADR-035): instantánea en texto, sin PDF ----
const sendDialogOpen = ref(false);
const sendEmails = ref("");
const sending = ref(false);
const sendError = ref<string | null>(null);
const sendSuccess = ref(false);

function openSendDialog() {
  sendDialogOpen.value = true;
  sendError.value = null;
  sendSuccess.value = false;
}

async function sendEmail() {
  const toEmails = sendEmails.value
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!toEmails.length) return;
  sending.value = true;
  sendError.value = null;
  try {
    await identityApi.sendMetricReportEmail(props.experimentId, props.reportId, toEmails);
    sendSuccess.value = true;
  } catch (err) {
    sendError.value = err instanceof Error ? err.message : "Could not send the email";
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <section class="report-view">
    <div class="report-toolbar">
      <div class="report-title">
        <template v-if="renaming">
          <TextInput class="rename-input" v-model="renameValue" @keyup.enter="saveRename" @keyup.escape="renaming = false" />
          <Button variant="primary" size="sm" :disabled="!renameValue.trim()" @click="saveRename">Save</Button>
          <Button size="sm" @click="renaming = false">Cancel</Button>
        </template>
        <template v-else>
          <h3>{{ report?.name }}</h3>
          <button v-if="!editMode" type="button" class="icon-link" title="Rename" @click="renameValue = report?.name ?? ''; renaming = true">Rename</button>
        </template>
      </div>

      <div class="report-actions">
        <template v-if="editMode">
          <Button size="sm" @click="cancelEdit">Cancel</Button>
          <Button variant="primary" size="sm" :disabled="savingLayout" @click="saveLayout">Save layout</Button>
        </template>
        <template v-else>
          <Button size="sm" @click="openSendDialog">Send by email</Button>
          <Button size="sm" @click="enterEdit">Edit layout</Button>
          <Button variant="danger" size="sm" @click="confirmingDelete = true">Delete</Button>
        </template>
      </div>
    </div>

    <div v-if="editMode" class="add-chart-row">
      <span class="add-chart-label">Add a saved chart:</span>
      <div v-if="!availableCharts.length" class="hint">You don't have any saved charts yet — save one from the "Custom charts" tab first.</div>
      <div v-else-if="!chartsNotInLayout.length" class="hint">All your saved charts are already in this report.</div>
      <div v-else class="add-chart-chips">
        <Button v-for="m in chartsNotInLayout" :key="m.id" size="sm" @click="addChart(m)">+ {{ m.name }}</Button>
      </div>
    </div>

    <ErrorBanner v-if="loadError" :error="loadError" @retry="loadReport" />
    <LoadingState v-else-if="loading && !report" size="lg" />
    <EmptyState v-else-if="report && !layout.length" icon="dashboard" :title="editMode ? 'Add a chart to get started' : 'No charts in this report yet'">
      <template v-if="editMode">Use the chips above to add a chart you've already saved in Custom charts.</template>
      <template v-else>
        <p class="hint">Add charts you've already saved in Custom charts.</p>
        <Button variant="primary" size="sm" @click="enterEdit">Edit layout</Button>
      </template>
    </EmptyState>

    <GridLayout v-else-if="report" v-model:layout="layout" :col-num="12" :row-height="60" :margin="[14, 14]" :is-draggable="editMode" :is-resizable="editMode" :vertical-compact="true" :use-css-transforms="true">
      <GridItem v-for="item in layout" :key="item.i" :i="item.i" :x="item.x" :y="item.y" :w="item.w" :h="item.h">
        <div class="report-chart-card">
          <div class="report-chart-head">
            <span class="name">{{ chartById.get(item.i)?.name }}</span>
            <Button variant="icon" size="sm" v-if="editMode" @click="removeFromLayout(item.i)"><q-icon name="close" size="16px" /></Button>
          </div>
          <div class="report-chart-body">
            <template v-if="chartById.get(item.i)">
              <div v-if="chartById.get(item.i)!.definition.chartType === 'number'" class="number-tile small">
                {{ formatMetricValue(chartById.get(item.i)!.definition.metric, singleNumber(chartById.get(item.i)!.definition.metric, results[item.i]?.points ?? [])) }}
              </div>
              <table v-else-if="chartById.get(item.i)!.definition.chartType === 'table'" class="result-table">
                <thead>
                  <tr>
                    <th>{{ chartById.get(item.i)!.definition.groupByAttribute || "Step" }}</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in results[item.i]?.points ?? []" :key="p.label">
                    <td>{{ p.label }}</td>
                    <td>{{ formatMetricValue(chartById.get(item.i)!.definition.metric, p.value) }}</td>
                  </tr>
                </tbody>
              </table>
              <EChart v-else-if="results[item.i]" :option="optionFor(results[item.i]!, chartById.get(item.i)!.definition.chartType, chartById.get(item.i)!.definition.metric)" height="100%" :label="chartById.get(item.i)!.name" />
              <div v-else class="loading-box small"><Spinner size="sm" /></div>
            </template>
          </div>
        </div>
      </GridItem>
    </GridLayout>

    <Modal v-if="confirmingDelete" title="Delete report" @close="confirmingDelete = false">
      <p>Delete report "{{ report?.name }}"? Its saved charts aren't affected.</p>
      <template #footer>
        <Button @click="confirmingDelete = false">Cancel</Button>
        <Button variant="danger" @click="confirmDelete">Delete</Button>
      </template>
    </Modal>

    <Modal v-if="sendDialogOpen" :title="`Send &quot;${report?.name}&quot; by email`" @close="sendDialogOpen = false">
      <p class="hint">Sends a text summary (one table per chart) over the current time range — no PDF attachment.</p>
      <TextInput v-model="sendEmails" placeholder="emails separated by comma" aria-label="Emails" />
      <p v-if="sendError" class="error-text">{{ sendError }}</p>
      <p v-if="sendSuccess" class="success-text">Sent.</p>
      <template #footer>
        <Button @click="sendDialogOpen = false">Close</Button>
        <Button variant="primary" :loading="sending" :disabled="!sendEmails.trim()" @click="sendEmail">Send</Button>
      </template>
    </Modal>
  </section>
</template>

<style scoped>
.report-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.report-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.report-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.report-title h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--mt-ink);
  letter-spacing: -0.01em;
}
.rename-input {
  width: 240px;
}
.icon-link {
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--mt-muted);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.icon-link:hover {
  color: var(--mt-accent);
}

.report-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.add-chart-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 14px 16px;
  background: var(--mt-soft);
  border-radius: var(--mt-radius-lg);
}
.add-chart-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.add-chart-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hint {
  font-size: 11.5px;
  color: var(--mt-muted);
}
.loading-box {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}
.loading-box.small {
  min-height: 60px;
}
.report-chart-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  box-shadow: var(--mt-shadow);
  overflow: hidden;
}
.report-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--mt-line-2);
  flex-shrink: 0;
}
.report-chart-head .name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mt-ink);
}
.report-chart-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 8px 12px 12px;
  overflow: auto;
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

.error-text {
  font-size: 12.5px;
  color: var(--mt-err-ink);
  margin: 8px 0 0;
}
.success-text {
  font-size: 12.5px;
  color: var(--mt-accent);
  margin: 8px 0 0;
}
</style>
