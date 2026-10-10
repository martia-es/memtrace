<script setup lang="ts">
import type { DatasetRunItemResultDto, RunListItemDto } from "@contract";
import { computed, watch } from "vue";
import { useRouter } from "vue-router";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import { formatDuration, formatDateTime } from "@/domain/format";
import { offlineRunLabel } from "../offline-eval-chart-option";
import { summarizeTelemetry } from "../offline-eval-compare";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import ErrorBanner from "./ErrorBanner.vue";
import KpiCard from "./KpiCard.vue";
import Select from "./Select.vue";
import Button from "./Button.vue";
import Pill from "./Pill.vue";
import DataTable from "./DataTable.vue";
import Card from "./Card.vue";

const props = defineProps<{ runs: RunListItemDto[]; runId: string | null }>();
const emit = defineEmits<{ "update:runId": [id: string] }>();

const api = useTraceApi();
const router = useRouter();

const runOptions = computed(() => [...props.runs].reverse().map((r) => ({ label: `${offlineRunLabel(r)} · ${formatDateTime(r.createdAt)}`, value: r.id })));
const current = computed(() => props.runs.find((r) => r.id === props.runId) ?? props.runs[props.runs.length - 1] ?? null);

const detail = useAsync((signal) => api.getDatasetRun(current.value!.datasetId, current.value!.id, signal));
const latency = computed(() => (detail.data.value ? summarizeTelemetry(detail.data.value.items) : null));

watch(current, (run) => void (run && detail.run()), { immediate: true });

function failed(item: DatasetRunItemResultDto): boolean {
  return !!item.error || item.scores.some((s) => s.dataType === "boolean" && s.value !== "true");
}
const problemItems = computed(() => (detail.data.value?.items ?? []).filter(failed));
const SHOWN = 15;

function preview(value: unknown): string {
  if (value === null || value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function failedScores(item: DatasetRunItemResultDto): string[] {
  return item.scores.filter((s) => s.dataType === "boolean" && s.value !== "true").map((s) => s.name);
}

function openFull() {
  if (current.value) void router.push({ name: "dataset-run", params: { datasetId: current.value.datasetId, runId: current.value.id } });
}
</script>

<template>
  <div class="run-view" v-if="current">
    <div class="toolbar">
      <div class="picker"><Select :model-value="current.id" :options="runOptions" placeholder="Select run" @update:model-value="emit('update:runId', $event)" /></div>
      <Button variant="link" @click="openFull">Open full item list →</Button>
    </div>

    <p class="hint">{{ current.datasetName }} · dataset v{{ current.versionMajor }}.{{ current.versionMinor }} · {{ current.itemCount }} items · {{ formatDateTime(current.createdAt) }}</p>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="detail.run()" />

    <div class="kpi-row">
      <KpiCard v-for="a in current.aggregates.filter((x) => x.passRate !== null || x.average !== null)" :key="a.name" :label="a.name" :value="aggregateValueLabel(a)" :tone="aggregateTone(a)" />
    </div>

    <Card as="section" padding="lg" gap="md" class="card">
      <h3>Latency</h3>
      <div v-if="detail.loading.value" class="hint">Reading linked traces…</div>
      <template v-else-if="latency && latency.count > 0">
        <div class="kpi-row">
          <KpiCard label="p50" :value="formatDuration(latency.p50!)" />
          <KpiCard label="p95" :value="formatDuration(latency.p95!)" />
          <KpiCard label="max" :value="formatDuration(latency.max!)" />
          <KpiCard label="tokens in / out" :value="`${latency.inputTokens} / ${latency.outputTokens}`" />
          <KpiCard v-if="latency.costUsd !== null" label="cost" :value="`$${latency.costUsd.toFixed(4)}`" />
        </div>
        <p class="hint">Read from the traces linked to {{ latency.count }} of {{ latency.total }} items.</p>
      </template>
      <p v-else class="hint">Latency, tokens and cost come from each item's trace. None found for this run: call <code>memtrace.init_tracer()</code> before <code>run_experiment</code> so every item is traced.</p>
    </Card>

    <Card as="section" padding="lg" gap="md" class="card">
      <h3>Items needing attention <span class="hint">({{ problemItems.length }} of {{ detail.data.value?.items.length ?? 0 }})</span></h3>
      <p v-if="detail.data.value && problemItems.length === 0" class="hint">No item failed a boolean evaluator or errored.</p>
      <DataTable v-else-if="problemItems.length" class="layout-fixed">
        <thead><tr><th>Input</th><th>Output</th><th class="failed-col">Failed</th></tr></thead>
        <tbody>
          <tr v-for="item in problemItems.slice(0, SHOWN)" :key="item.itemIndex">
            <td class="preview" :title="preview(item.input)">{{ preview(item.input) }}</td>
            <td class="preview" :title="item.error ?? preview(item.output)">{{ item.error ? `error: ${item.error}` : preview(item.output) }}</td>
            <td><Pill tone="error" v-for="n in failedScores(item)" :key="n" class="fail">{{ n }}</Pill><span v-if="!failedScores(item).length" class="muted">–</span></td>
          </tr>
        </tbody>
      </DataTable>
      <p v-if="problemItems.length > SHOWN" class="hint">Showing {{ SHOWN }}; open the full item list for the rest.</p>
    </Card>
  </div>
</template>

<style scoped>
.run-view { display: flex; flex-direction: column; flex-shrink: 0; gap: 16px; min-width: 0; font-family: var(--mt-sans); }
.toolbar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.picker { min-width: 280px; }
.link { background: none; border: 0; cursor: pointer; color: var(--mt-accent-text); font: inherit; font-size: 12.5px; font-weight: 600; }
.link:hover { text-decoration: underline; }
.hint { margin: 0; font-size: 12.5px; color: var(--mt-muted); }
.hint code { font-family: var(--mt-mono); font-size: 12px; background: var(--mt-soft); padding: 1px 5px; border-radius: var(--mt-radius-sm); }
.kpi-row { display: flex; flex-wrap: wrap; gap: 12px; }
h3 { margin: 0 0 12px; font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
h3 .hint { font-weight: 400; }
.card { flex-shrink: 0; gap: 10px; }
.card h3 { margin: 0; }
.layout-fixed { table-layout: fixed; }
.layout-fixed .preview { max-width: none; }
.layout-fixed th:first-child { width: 34%; }
.failed-col { width: 200px; }
.fail { margin: 2px 4px 2px 0; }
.muted { color: var(--mt-muted); }
</style>
