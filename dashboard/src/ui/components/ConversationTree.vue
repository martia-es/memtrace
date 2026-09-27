<script setup lang="ts">
import type { TraceDetailResponse } from "@contract";
import { computed, ref } from "vue";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import StatusBadge from "./StatusBadge.vue";
import SpanTree from "./SpanTree.vue";

const props = defineProps<{ turns: TraceDetailResponse[]; selectedTraceId: string | null; selectedSpanId: string | null }>();
const emit = defineEmits<{ select: [traceId: string, spanId: string] }>();

const rootName = (t: TraceDetailResponse) => t.roots.find((r) => !r.orphan)?.name ?? t.roots[0]?.name ?? "Trace";

const collapsed = ref<Set<string>>(new Set());
const toggle = (traceId: string) => {
  const next = new Set(collapsed.value);
  if (!next.delete(traceId)) next.add(traceId);
  collapsed.value = next;
};

const summary = computed(() => {
  const durations = [...props.turns.map((t) => t.durationMs)].sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const p50 = durations.length === 0 ? 0 : durations.length % 2 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2;
  const totalTokens = props.turns.reduce((sum, t) => sum + t.totalTokens, 0);
  const totalSpans = props.turns.reduce((sum, t) => sum + t.spanCount, 0);
  const errorRuns = props.turns.filter((t) => t.status === "error").length;
  return { count: props.turns.length, p50, totalTokens, totalSpans, errorRuns };
});
</script>

<template>
  <div class="conv-tree">
    <div class="summary">
      <span class="s-label">Summary</span>
      <span class="s-item"><q-icon name="tag" size="14px" /> {{ summary.count }} {{ summary.count === 1 ? "run" : "runs" }}</span>
      <span class="s-item"><q-icon name="schedule" size="14px" /> P50 {{ formatDuration(summary.p50) }}</span>
      <span class="s-item"><q-icon name="account_tree" size="14px" /> {{ formatCount(summary.totalSpans) }} spans</span>
      <span v-if="summary.totalTokens" class="s-item"><q-icon name="toll" size="14px" /> {{ formatCount(summary.totalTokens) }} tokens</span>
      <span v-if="summary.errorRuns" class="s-item err"><q-icon name="error" size="14px" /> {{ summary.errorRuns }} {{ summary.errorRuns === 1 ? "run" : "runs" }} with error</span>
    </div>

    <ol class="runs">
      <li v-for="(t, i) in turns" :key="t.traceId" class="run">
        <button type="button" class="run-head" @click="toggle(t.traceId)">
          <span class="badge">{{ i + 1 }}</span>
          <span class="caret" :class="{ collapsed: collapsed.has(t.traceId) }">
            <q-icon name="expand_more" size="16px" />
          </span>
          <span class="run-name mono" :title="rootName(t)">{{ t.framework ?? rootName(t) }}</span>
          <span class="muted run-time">{{ formatDateTime(t.startTime) }}</span>
          <span class="run-pills">
            <StatusBadge :status="t.status" />
            <span class="mt-pill unset">{{ formatDuration(t.durationMs) }}</span>
            <span v-if="t.totalTokens" class="mt-pill unset">{{ formatCount(t.totalTokens) }} tok</span>
            <span v-if="t.errorCount" class="mt-pill error">{{ t.errorCount }} err</span>
          </span>
        </button>
        <div v-show="!collapsed.has(t.traceId)" class="run-body">
          <SpanTree
            :roots="t.roots"
            :total-ms="t.durationMs"
            :selected-id="t.traceId === selectedTraceId ? selectedSpanId : null"
            @select="(spanId) => emit('select', t.traceId, spanId)"
          />
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.conv-tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--mt-line-2);
  font-size: 12.5px;
  color: var(--mt-muted);
  flex-shrink: 0;
}
.s-label {
  font-weight: 700;
  color: var(--mt-ink);
}
.s-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.s-item.err {
  color: var(--mt-err-ink);
}
.runs {
  list-style: none;
  margin: 0;
  padding: 0 2px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}
.run {
  border: 1px solid var(--mt-line-2);
  border-radius: var(--mt-radius-lg);
}
.run-head {
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: var(--mt-ink);
}
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--mt-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
}
.caret {
  flex-shrink: 0;
  display: flex;
  transition: transform 0.15s;
}
.caret.collapsed {
  transform: rotate(-90deg);
}
.run-name {
  font-weight: 600;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.run-time {
  font-size: 11.5px;
  flex-shrink: 0;
}
.run-pills {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  flex-shrink: 0;
}
.mt-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--mt-radius-sm);
  font-size: 11px;
  font-weight: 600;
}
.mt-pill.error {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.mt-pill.unset {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.run-body {
  padding: 8px 8px 10px;
  border-top: 1px solid var(--mt-line-2);
}
</style>
