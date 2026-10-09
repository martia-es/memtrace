<script setup lang="ts">
import type { DatasetRunItemResultDto, ScoreDto } from "@contract";
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute } from "vue-router";
import { formatDuration } from "@/domain/format";
import Button from "./Button.vue";
import Pill from "./Pill.vue";

const route = useRoute();
const props = defineProps<{ item: DatasetRunItemResultDto; position: number; total: number; hasPrev: boolean; hasNext: boolean }>();
const emit = defineEmits<{ close: []; prev: []; next: [] }>();

function text(value: unknown): string {
  if (value === null || value === undefined) return "–";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function failed(s: ScoreDto): boolean {
  return s.dataType === "boolean" && s.value !== "true";
}

function pillClass(s: ScoreDto): "neutral" | "ok" | "error" {
  if (s.dataType !== "boolean") return "neutral";
  return s.value === "true" ? "ok" : s.value === "false" ? "error" : "neutral";
}

function sourceLabel(s: ScoreDto): string {
  return s.source === "llm_judge" ? "LLM judge" : s.source === "human" ? "human" : "rule-based";
}

function judgeLine(s: ScoreDto): string | null {
  if (!s.judgeModel && !s.judgePromptHash) return null;
  return `${s.judgeModel ?? "unknown model"}${s.judgePromptHash ? ` · rubric ${s.judgePromptHash}` : ""}`;
}

/** Los que fallan primero: es lo que se viene a buscar al abrir el panel. */
const scores = computed(() => [...props.item.scores].sort((a, b) => Number(failed(b)) - Number(failed(a))));
const failedCount = computed(() => props.item.scores.filter(failed).length + (props.item.error ? 1 : 0));
const telemetry = computed(() => props.item.telemetry);
/** Sin telemetría la traza no está en el almacén (no se exportó o expiró): el enlace daría "no existe". */
const traceLink = computed(() => (props.item.traceId && props.item.telemetry ? { name: "trace", params: { experimentId: route.params.experimentId as string, traceId: props.item.traceId } } : null));

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <aside class="item-panel" data-testid="run-item-panel" aria-label="Item detail">
    <header class="head">
      <div class="title">
        <strong>Item {{ item.itemIndex + 1 }}</strong>
        <span class="muted">{{ position }} of {{ total }}</span>
        <Pill tone="error" v-if="failedCount > 0">{{ failedCount }} failed</Pill>
        <Pill tone="ok" v-else>all passed</Pill>
      </div>
      <div class="nav">
        <Button v-if="traceLink" size="sm" :to="traceLink" data-testid="run-item-trace">Open trace</Button>
        <span v-else-if="item.traceId" class="muted small" data-testid="run-item-no-trace" title="The trace was not stored or has expired">Trace not available</span>
        <Button variant="icon" :disabled="!hasPrev" aria-label="Previous item" data-testid="run-item-prev" @click="emit('prev')">‹</Button>
        <Button variant="icon" :disabled="!hasNext" aria-label="Next item" data-testid="run-item-next" @click="emit('next')">›</Button>
        <Button variant="icon" aria-label="Close" data-testid="run-item-close" @click="emit('close')">✕</Button>
      </div>
    </header>

    <div class="body">
      <h3 class="question">{{ text(item.input) }}</h3>

      <section v-if="item.error" class="card err-card">
        <h4>Error</h4>
        <pre class="block err">{{ item.error }}</pre>
      </section>

      <div class="outputs">
        <section class="card">
          <h4>Expected output</h4>
          <pre class="block" :class="{ empty: item.expectedOutput == null }">{{ text(item.expectedOutput) }}</pre>
        </section>
        <section class="card" :class="{ 'err-card': failedCount > 0 && !item.error }">
          <h4>Generated output</h4>
          <pre class="block" :class="{ empty: item.output == null }">{{ text(item.output) }}</pre>
        </section>
      </div>

      <section class="card flush">
        <h4 class="bar">Scores</h4>
        <p v-if="scores.length === 0" class="muted pad">This item has no scores.</p>
        <div v-for="s in scores" :key="s.name" class="score" :class="{ bad: failed(s) }" :data-testid="`run-item-score-${s.name}`">
          <div class="score-head">
            <span class="mono name">{{ s.name }}</span>
            <Pill :tone="pillClass(s)">{{ s.dataType === "boolean" ? s.value.toUpperCase() : s.value }}</Pill>
            <span class="spacer" />
            <span class="muted small">{{ s.dataType }} · {{ sourceLabel(s) }}</span>
          </div>
          <p v-if="s.comment" class="comment" :class="{ bad: failed(s) }">{{ s.comment }}</p>
          <p v-else class="muted small">No explanation recorded by the evaluator.</p>
          <p v-if="judgeLine(s)" class="muted small">Judge: {{ judgeLine(s) }}</p>
        </div>
      </section>

      <section v-if="telemetry" class="card">
        <h4>Telemetry</h4>
        <div class="telemetry">
          <div><span class="muted small">Latency</span><strong class="mono">{{ formatDuration(telemetry.latencyMs) }}</strong></div>
          <div><span class="muted small">Tokens in / out</span><strong class="mono">{{ telemetry.inputTokens }} / {{ telemetry.outputTokens }}</strong></div>
          <div v-if="telemetry.costUsd !== null"><span class="muted small">Cost</span><strong class="mono">${{ telemetry.costUsd.toFixed(4) }}</strong></div>
        </div>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.item-panel { width: clamp(560px, 46vw, 820px); flex: none; display: flex; flex-direction: column; min-height: 0; background: var(--mt-bg); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); overflow: hidden; font-size: 13.5px; }
.head { flex: none; height: 52px; box-sizing: border-box; padding: 0 14px 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--mt-card, #fff); border-bottom: 1px solid var(--mt-line); font-size: 14px; }
.title { display: flex; align-items: center; gap: 10px; }
.nav { display: flex; align-items: center; gap: 6px; }

.body { flex: 1; min-height: 0; overflow: auto; padding: 18px 20px 24px; display: flex; flex-direction: column; gap: 14px; }
.question { margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.35; overflow-wrap: anywhere; }
.outputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.card { background: var(--mt-card, #fff); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.card.flush { padding: 0; gap: 0; overflow: hidden; }
.card.err-card { border-color: var(--mt-err); }
h4 { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mt-muted); }
h4.bar { padding: 11px 16px; background: var(--mt-soft); border-bottom: 1px solid var(--mt-line); font-size: 12px; color: var(--mt-ink); }
.block { margin: 0; font: inherit; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow: auto; }
.block.empty { color: var(--mt-faint); }
.block.err, .err-card h4 { color: var(--mt-err-ink); }
.score { padding: 14px 16px; border-bottom: 1px solid var(--mt-line-2); display: flex; flex-direction: column; gap: 8px; }
.score:last-child { border-bottom: 0; }
.score.bad { background: var(--mt-err-bg, rgba(225, 29, 72, 0.06)); }
.score-head { display: flex; align-items: center; gap: 10px; }
.name { font-weight: 600; }
.spacer { flex: 1; }
.comment { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.comment.bad { color: var(--mt-err-ink); font-weight: 600; }
.muted { color: var(--mt-muted); margin: 0; }
.pad { padding: 14px 16px; }
.small { font-size: 12px; }
.telemetry { display: flex; gap: 32px; flex-wrap: wrap; }
.telemetry div { display: flex; flex-direction: column; gap: 2px; }

</style>
