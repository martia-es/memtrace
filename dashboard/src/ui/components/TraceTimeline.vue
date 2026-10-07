<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { formatDuration } from "@/domain/format";
import { buildTimeline, type StepGroup } from "@/domain/span-timeline";
import { SPAN_COLORS } from "@/domain/palette";
import { axisTicks } from "@/domain/waterfall";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

/**
 * Where the time of one reply went, under that reply: a single line with its sequential steps (guardrail, model call,
 * tool…) that expands into the steps with what ran inside each one. Loads its own trace; if it cannot, it stays out of
 * the way — the reply is readable without it.
 */
const props = defineProps<{ traceId: string }>();

const api = useTraceApi();
const route = useRoute();
const trace = useAsync((signal) => api.getTrace(props.traceId, signal));
void trace.run();

const open = ref(false);
const timeline = computed(() => (trace.data.value ? buildTimeline(trace.data.value.roots, trace.data.value.durationMs) : null));
const ticks = computed(() => axisTicks(timeline.value?.totalMs ?? 0, 4));
const groupsPresent = computed(() => {
  const seen = new Set<StepGroup>(timeline.value?.rows.map((r) => r.group));
  return (["guardrail", "llm", "tool"] as const).filter((g) => seen.has(g));
});
const LEGEND: Record<"guardrail" | "llm" | "tool", { label: string; color: string }> = {
  guardrail: { label: "Guardrail", color: SPAN_COLORS.guardrail },
  llm: { label: "LLM", color: SPAN_COLORS.llm },
  tool: { label: "Tool", color: SPAN_COLORS.tool },
};
const barColor = (color: string, failed: boolean) => (failed ? "var(--mt-err-ink)" : color);
</script>

<template>
  <section v-if="timeline && timeline.phases.length" class="timeline" :class="{ open }" aria-label="Where the time went" data-testid="trace-timeline">
    <button type="button" class="head" :aria-expanded="open" aria-label="Toggle timeline" data-testid="timeline-toggle" @click="open = !open">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="icon"><path d="M3 6h10M7 12h13M5 18h8" /></svg>
      <span class="title">Timeline</span>
      <span class="meta mono">{{ formatDuration(timeline.totalMs) }} · {{ trace.data.value!.spanCount }} spans</span>
      <span v-if="!open && timeline.slowest" class="slowest">Slowest · <b>{{ timeline.slowest.label }} {{ formatDuration(timeline.slowest.node.durationMs) }}</b></span>
      <q-icon name="expand_more" size="18px" class="chev" />
    </button>

    <button v-if="!open" type="button" class="line" aria-label="Show step breakdown" data-testid="timeline-line" @click="open = true">
      <span class="bar">
        <span
          v-for="p in timeline.phases"
          :key="p.node.spanId"
          class="seg"
          :title="`${p.label} · ${formatDuration(p.node.durationMs)}`"
          :style="{ left: `${p.leftPct}%`, width: `${p.widthPct}%`, background: barColor(p.color, p.failed) }"
        />
      </span>
      <span class="legend">
        <span v-for="p in timeline.phases" :key="p.node.spanId" class="item">
          <span class="dot" :style="{ background: barColor(p.color, p.failed) }" />{{ p.label }}
          <span class="mono faint">{{ formatDuration(p.node.durationMs) }}</span>
        </span>
      </span>
    </button>

    <div v-else class="detail" data-testid="timeline-rows">
      <div class="keys">
        <span v-for="g in groupsPresent" :key="g" class="key"><span class="sw" :style="{ background: LEGEND[g].color }" />{{ LEGEND[g].label }}</span>
        <span class="spacer" />
        <router-link :to="{ name: 'trace', params: { experimentId: route.params.experimentId, traceId }, query: route.query }" class="open-trace">Open in trace ↗</router-link>
      </div>
      <div class="grid axis" aria-hidden="true">
        <span class="th">SPAN</span>
        <span class="ticks mono"><span v-for="t in ticks" :key="t.pct">{{ t.ms === 0 ? "0" : formatDuration(t.ms) }}</span></span>
        <span />
      </div>
      <div v-for="r in timeline.rows" :key="r.node.spanId" class="grid row" :class="{ child: r.depth === 1 }">
        <span class="name">
          <span v-if="r.depth === 0" class="sw" :style="{ background: barColor(r.color, r.failed) }" />
          <span class="label" :class="{ mono: r.depth === 1, err: r.failed }" :title="r.node.name">{{ r.label }}</span>
        </span>
        <span class="track">
          <span class="fill" :style="{ left: `${r.leftPct}%`, width: `${r.widthPct}%`, background: barColor(r.color, r.failed) }" />
        </span>
        <span class="dur mono" :class="{ slow: r === timeline.slowest, err: r.failed }">{{ formatDuration(r.node.durationMs) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline {
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  overflow: hidden;
  font-size: 12px;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px 8px 12px;
  border: 0;
  background: none;
  color: var(--mt-ink);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.icon {
  flex: none;
  color: var(--mt-accent-text);
}
.meta {
  color: var(--mt-muted);
  font-weight: 500;
}
.slowest {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--mt-muted);
  font-weight: 600;
}
.slowest b {
  color: var(--mt-ink);
}
.chev {
  flex: none;
  margin-left: auto;
  color: var(--mt-muted);
  transition: transform 0.15s;
}
.slowest + .chev {
  margin-left: 0;
}
.open .chev {
  transform: rotate(180deg);
}
.line {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 0 12px 10px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.bar {
  position: relative;
  display: block;
  height: 6px;
  border-radius: 3px;
  background: var(--mt-line-2);
}
.seg {
  position: absolute;
  top: 0;
  bottom: 0;
  min-width: 3px;
  border-radius: 3px;
  opacity: 0.85;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  padding-top: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--mt-muted);
}
.item {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.faint {
  font-size: 10.5px;
  color: var(--mt-faint);
}
.detail {
  display: flex;
  flex-direction: column;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--mt-line-2);
}
.keys {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-muted);
}
.key {
  display: flex;
  align-items: center;
  gap: 5px;
}
.sw {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
}
.spacer {
  flex: 1;
}
.open-trace {
  font-weight: 700;
  color: var(--mt-accent-text);
  text-decoration: none;
}
.open-trace:hover {
  text-decoration: underline;
}
.grid {
  display: grid;
  grid-template-columns: 136px minmax(0, 1fr) 52px;
  column-gap: 8px;
  align-items: center;
}
.axis {
  height: 20px;
  font-size: 10px;
  color: var(--mt-faint);
}
.th {
  font-weight: 700;
  letter-spacing: 0.05em;
}
.ticks {
  display: flex;
  justify-content: space-between;
}
.row {
  height: 26px;
}
.name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.row.child .name {
  padding-left: 16px;
}
.label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 700;
}
.row.child .label {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--mt-muted);
}
.track {
  position: relative;
  height: 26px;
  background: repeating-linear-gradient(to right, var(--mt-line-2) 0, var(--mt-line-2) 1px, transparent 1px, transparent 25%);
}
.fill {
  position: absolute;
  top: 6px;
  height: 14px;
  min-width: 3px;
  border-radius: 3px;
}
.row.child .fill {
  top: 8px;
  height: 10px;
  opacity: 0.6;
}
.dur {
  font-size: 11.5px;
  font-weight: 400;
  text-align: right;
}
.dur.slow {
  color: var(--mt-warn-ink, var(--mt-err-ink));
  font-weight: 700;
}
.err {
  color: var(--mt-err-ink);
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
