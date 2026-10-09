<script setup lang="ts">
import type { ScoreDto } from "@contract";
import { computed, nextTick, ref } from "vue";
import { useRoute } from "vue-router";
import { formatDateTime } from "@/domain/format";
import { aggregateTone, aggregateValueLabel } from "@/domain/evaluation";
import AddToQueueModal from "../components/AddToQueueModal.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import JudgeHumanAgreement from "../components/JudgeHumanAgreement.vue";
import KpiCard from "../components/KpiCard.vue";
import RunItemPanel from "../components/RunItemPanel.vue";
import PageHeader from "../components/PageHeader.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import { useExperimentRepo } from "../composables/useExperimentRepo";
import CommitLink from "../components/CommitLink.vue";
import PromptChips from "../components/PromptChips.vue";

const api = useTraceApi();
const route = useRoute();
const repo = useExperimentRepo(() => route.params.experimentId as string);
const datasetId = computed(() => route.params.datasetId as string);
const runId = computed(() => route.params.runId as string);

const run = useAsync((signal) => api.getDatasetRun(datasetId.value, runId.value, signal));
void run.run();

const addingToQueue = ref(false);
const highlighted = ref<number | null>(null);

/** Lleva a un item citado por el panel de acuerdo y lo resalta un momento. */
async function showItem(itemIndex: number) {
  highlighted.value = itemIndex;
  await nextTick();
  document.getElementById(`item-${itemIndex}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

const selectedIndex = ref<number | null>(null);
const items = computed(() => run.data.value?.items ?? []);
const selectedPos = computed(() => items.value.findIndex((i) => i.itemIndex === selectedIndex.value));
const selectedItem = computed(() => (selectedPos.value >= 0 ? items.value[selectedPos.value] : null));

function step(delta: number) {
  const next = items.value[selectedPos.value + delta];
  if (next) selectedIndex.value = next.itemIndex;
}

const hasAnyTraceId = computed(() => run.data.value?.items.some((i) => i.traceId) ?? false);

function preview(value: unknown): string {
  if (value === null || value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function scorePillClass(s: ScoreDto) {
  if (s.dataType !== "boolean") return "unset";
  return s.value === "true" ? "ok" : s.value === "false" ? "error" : "unset";
}

/** Tooltip de un score: razonamiento del juez y, si lo hay, qué modelo y rúbrica lo emitieron (ADR-043). */
function scoreTitle(s: ScoreDto): string | undefined {
  const judge = s.judgeModel || s.judgePromptHash ? `Judge: ${s.judgeModel ?? "unknown model"}${s.judgePromptHash ? ` · rubric ${s.judgePromptHash}` : ""}` : null;
  return [s.comment, judge].filter(Boolean).join("\n") || undefined;
}

/** Las versiones de prompt con las que se produjeron los items de la run (ADR-068): una run que mezcla versiones se ve a simple vista. */
const runPrompts = computed(() => {
  const seen = new Map<string, { name: string; version: number }>();
  for (const item of run.data.value?.items ?? []) for (const p of item.telemetry?.prompts ?? []) seen.set(`${p.name}@${p.version}`, p);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
});

function sourceSuffix(s: ScoreDto): string | null {
  if (s.source === "llm_judge") return "LLM";
  if (s.source === "human") return "human";
  return null;
}
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Evaluation', to: { name: 'datasets' } }, { label: run.data.value?.dataset.name ?? '…', to: { name: 'dataset', params: { datasetId } } }, { label: run.data.value?.run.name ?? runId }]" icon="playlist_add_check" :title="run.data.value?.run.name ?? 'Run'" />

    <ErrorBanner v-if="run.error.value" :error="run.error.value" @retry="run.run()" />
    <div v-else-if="run.loading.value && !run.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <template v-else>
      <div class="artifacts">
        <span class="artifact">Dataset: <router-link :to="{ name: 'dataset', params: { datasetId } }">{{ run.data.value!.dataset.name }}</router-link></span>
        <span class="artifact">Agent version: <strong>{{ run.data.value!.run.name }}</strong></span>
        <span v-if="run.data.value!.run.revision" class="artifact">Code version: <CommitLink :revision="run.data.value!.run.revision" :repo="repo" :dirty="run.data.value!.run.revisionDirty" /></span>
        <span v-if="runPrompts.length > 0" class="artifact" data-testid="run-prompts">Prompt: <PromptChips :prompts="runPrompts" :max="4" /></span>
        <span class="artifact">{{ run.data.value!.run.itemCount }} items</span>
        <span v-if="run.data.value!.run.status === 'running'" class="artifact mt-pill warn" title="Still receiving results, or the process stopped before finishing">running</span>
        <span class="artifact">{{ formatDateTime(run.data.value!.run.createdAt) }}</span>
      </div>

      <div v-if="run.data.value!.run.aggregates.length > 0" class="kpi-row">
        <KpiCard
          v-for="a in run.data.value!.run.aggregates"
          :key="a.name"
          :label="a.name"
          :value="aggregateValueLabel(a)"
          :tone="aggregateTone(a)"
        />
      </div>

      <JudgeHumanAgreement :scope="{ datasetRunId: runId }" @select-item="showItem">
        <template #actions>
          <button v-if="run.data.value!.items.length > 0" type="button" class="small-btn" data-testid="add-run-items-to-queue" @click="addingToQueue = true">
            Send items to a review queue
          </button>
        </template>
      </JudgeHumanAgreement>
      <AddToQueueModal v-if="addingToQueue" :run="{ datasetRunId: runId, itemCount: run.data.value!.run.itemCount }" @close="addingToQueue = false" />

      <EmptyState v-if="run.data.value!.items.length === 0" icon="playlist_add_check" title="No items">This run has no items.</EmptyState>

      <div v-else class="items-area">
      <div class="mt-card table-card">
        <table class="items">
          <thead>
            <tr>
              <th class="idx">#</th>
              <th>Input</th>
              <th>Expected</th>
              <th>Output</th>
              <th>Scores</th>
              <th v-if="hasAnyTraceId">Prompt</th>
              <th v-if="hasAnyTraceId">Trace</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in run.data.value!.items" :id="`item-${item.itemIndex}`" :key="item.itemIndex" class="item-row" :class="{ error: item.error, highlighted: highlighted === item.itemIndex, selected: selectedIndex === item.itemIndex }" tabindex="0" @click="selectedIndex = item.itemIndex" @keydown.enter="selectedIndex = item.itemIndex">
              <td class="idx mono">{{ item.itemIndex + 1 }}</td>
              <td><div class="preview" :title="preview(item.input)">{{ preview(item.input) }}</div></td>
              <td><div class="preview" :class="{ empty: item.expectedOutput == null }" :title="preview(item.expectedOutput)">{{ preview(item.expectedOutput) }}</div></td>
              <td><div class="preview" :title="item.error ?? preview(item.output)">{{ item.error ? `error: ${item.error}` : preview(item.output) }}</div></td>
              <td>
                <div class="scores">
                  <span v-if="item.scores.length === 0" class="muted">–</span>
                  <span v-for="s in item.scores" :key="s.name" class="mt-pill" :class="scorePillClass(s)" :title="scoreTitle(s)">
                    {{ s.name }}={{ s.value }}<span v-if="sourceSuffix(s)" class="source"> · {{ sourceSuffix(s) }}</span>
                  </span>
                </div>
              </td>
              <td v-if="hasAnyTraceId"><PromptChips :prompts="item.telemetry?.prompts ?? []" :max="2" /></td>
              <td v-if="hasAnyTraceId" class="mono muted trace-id" :title="item.traceId ?? undefined">{{ item.traceId ?? "–" }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <RunItemPanel
        v-if="selectedItem"
        :item="selectedItem"
        :position="selectedPos + 1"
        :total="items.length"
        :has-prev="selectedPos > 0"
        :has-next="selectedPos < items.length - 1"
        @close="selectedIndex = null"
        @prev="step(-1)"
        @next="step(1)"
      />
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.artifacts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  font-size: 13px;
  color: var(--mt-muted);
}
.artifact a {
  color: var(--mt-accent-text);
  font-weight: 700;
}
.artifact strong {
  color: var(--mt-ink);
  font-weight: 600;
}
.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.items-area {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}
.item-row {
  cursor: pointer;
}
.item-row.selected td {
  background: var(--mt-accent-soft, rgba(0, 179, 173, 0.1));
}
.table-card {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.items {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  table-layout: fixed;
}
.items th:nth-child(1),
.items td:nth-child(1) {
  width: 56px;
}
.items th:nth-child(5),
.items td:nth-child(5) {
  width: 260px;
}
.items th:nth-child(6),
.items td:nth-child(6) {
  width: 150px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 38px;
  padding: 0 16px;
  background: var(--mt-soft);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}
td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--mt-line-2);
  vertical-align: top;
}
.item-row:last-child td {
  border-bottom: 0;
}
.item-row:hover td {
  background: var(--mt-soft-2);
}
.idx {
  color: var(--mt-faint);
  font-size: 12px;
  text-align: right;
  padding-right: 4px;
}
.item-row.error td:first-child {
  box-shadow: inset 3px 0 0 var(--mt-err);
}
/* tres líneas como máximo: el texto completo sigue en el tooltip */
.preview {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.preview.empty {
  color: var(--mt-faint);
}
.item-row.highlighted td {
  background: var(--mt-warn-bg, rgba(245, 158, 11, 0.14));
}
.small-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card, #fff);
  color: var(--mt-ink);
  font-size: 12.5px;
  cursor: pointer;
}
.item-row.error td:nth-child(4) .preview {
  color: var(--mt-err-ink);
}
.muted {
  color: var(--mt-muted);
}
.scores {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.source {
  opacity: 0.75;
  font-size: 11px;
}
.trace-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
</style>
