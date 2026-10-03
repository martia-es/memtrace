<script setup lang="ts">
import type { DatasetRunItemResultDto, RunListItemDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import { formatDuration, formatDateTime } from "@/domain/format";
import { offlineRunLabel } from "../offline-eval-chart-option";
import { loadItemLatencies, type LatencySummary } from "../offline-eval-compare";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import ErrorBanner from "./ErrorBanner.vue";
import KpiCard from "./KpiCard.vue";
import Select from "./Select.vue";

const props = defineProps<{ runs: RunListItemDto[]; runId: string | null }>();
const emit = defineEmits<{ "update:runId": [id: string] }>();

const api = useTraceApi();
const router = useRouter();

const runOptions = computed(() => [...props.runs].reverse().map((r) => ({ label: `${offlineRunLabel(r)} · ${formatDateTime(r.createdAt)}`, value: r.id })));
const current = computed(() => props.runs.find((r) => r.id === props.runId) ?? props.runs[props.runs.length - 1] ?? null);

const detail = useAsync((signal) => api.getDatasetRun(current.value!.datasetId, current.value!.id, signal));
const latency = ref<LatencySummary | null>(null);

watch(
  current,
  async (run) => {
    latency.value = null;
    if (!run) return;
    const d = await detail.run();
    if (!d) return;
    latency.value = (await loadItemLatencies(d.items, async (id) => (await api.getTrace(id)).durationMs)).summary;
  },
  { immediate: true },
);

function failed(item: DatasetRunItemResultDto): boolean {
  return !!item.error || item.scores.some((s) => s.dataType === "boolean" && s.value !== "true");
}
const problemItems = computed(() => (detail.data.value?.items ?? []).filter(failed));
const SHOWN = 15;

function preview(value: unknown): string {
  if (value === null || value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function failedScores(item: DatasetRunItemResultDto): string {
  return item.scores.filter((s) => s.dataType === "boolean" && s.value !== "true").map((s) => s.name).join(", ");
}

function openFull() {
  if (current.value) void router.push({ name: "dataset-run", params: { datasetId: current.value.datasetId, runId: current.value.id } });
}
</script>

<template>
  <div class="run-view" v-if="current">
    <div class="toolbar">
      <div class="picker"><Select :model-value="current.id" :options="runOptions" placeholder="Select run" @update:model-value="emit('update:runId', $event)" /></div>
      <button type="button" class="link" @click="openFull">Open full item list →</button>
    </div>

    <p class="hint">{{ current.datasetName }} · dataset v{{ current.versionMajor }}.{{ current.versionMinor }} · {{ current.itemCount }} items · {{ formatDateTime(current.createdAt) }}</p>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="detail.run()" />

    <div class="kpi-row">
      <KpiCard v-for="a in current.aggregates.filter((x) => x.passRate !== null || x.average !== null)" :key="a.name" :label="a.name" :value="aggregateValueLabel(a)" :tone="aggregateTone(a)" />
    </div>

    <section class="card">
      <h3>Latency</h3>
      <div v-if="detail.loading.value || (detail.data.value && !latency)" class="hint">Reading linked traces…</div>
      <template v-else-if="latency && latency.count > 0">
        <div class="kpi-row">
          <KpiCard label="p50" :value="formatDuration(latency.p50!)" />
          <KpiCard label="p95" :value="formatDuration(latency.p95!)" />
          <KpiCard label="max" :value="formatDuration(latency.max!)" />
        </div>
        <p class="hint">Measured from the traces linked to {{ latency.count }} of {{ latency.total }} items (first 100 traced items at most).</p>
      </template>
      <p v-else class="hint">Latency is not recorded for this run: no item has a linked trace. Trace the agent inside <code>task</code> to get it for now; native per-item latency is tracked in ADR-042.</p>
    </section>

    <section class="card">
      <h3>Items needing attention <span class="hint">({{ problemItems.length }} of {{ detail.data.value?.items.length ?? 0 }})</span></h3>
      <p v-if="detail.data.value && problemItems.length === 0" class="hint">No item failed a boolean evaluator or errored.</p>
      <table v-else-if="problemItems.length" class="tbl">
        <thead><tr><th>Input</th><th>Output</th><th>Failed</th></tr></thead>
        <tbody>
          <tr v-for="item in problemItems.slice(0, SHOWN)" :key="item.itemIndex">
            <td class="preview" :title="preview(item.input)">{{ preview(item.input) }}</td>
            <td class="preview" :title="item.error ?? preview(item.output)">{{ item.error ? `error: ${item.error}` : preview(item.output) }}</td>
            <td>{{ failedScores(item) || "–" }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="problemItems.length > SHOWN" class="hint">Showing {{ SHOWN }}; open the full item list for the rest.</p>
    </section>
  </div>
</template>

<style scoped>
.run-view { display: flex; flex-direction: column; gap: 14px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.picker { min-width: 280px; }
.link { background: none; border: 0; cursor: pointer; color: inherit; text-decoration: underline; font-size: 12px; }
.hint { margin: 0; font-size: 12px; opacity: 0.7; }
.kpi-row { display: flex; flex-wrap: wrap; gap: 12px; }
h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; }
.card { border: 1px solid var(--mt-border, rgba(128, 128, 128, 0.25)); border-radius: 8px; padding: 14px 16px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
.tbl th, .tbl td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--mt-border, rgba(128, 128, 128, 0.2)); }
.preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
