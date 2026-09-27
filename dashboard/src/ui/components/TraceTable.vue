<script setup lang="ts">
import type { TraceSummaryDto } from "@contract";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import StatusBadge from "./StatusBadge.vue";

defineProps<{
  items: TraceSummaryDto[];
  newKeys?: Set<string>;
  /** alternative text to the root span name (e.g., the user message) */
  labels?: Map<string, string | null | undefined>;
  showConversation?: boolean;
}>();
defineEmits<{ open: [traceId: string]; openConversation: [conversationId: string] }>();
</script>

<template>
  <table class="traces">
    <thead>
      <tr>
        <th>Trace</th>
        <th>Trace ID</th>
        <th>Input</th>
        <th>Output</th>
        <th>Service</th>
        <th>Start Time</th>
        <th class="num">Duration</th>
        <th class="num">Spans</th>
        <th class="num">Tokens</th>
        <th>Status</th>
        <th v-if="showConversation">Conversation</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="t in items" :key="t.traceId" class="item" :class="{ fresh: newKeys?.has(t.traceId) }" tabindex="0" @click="$emit('open', t.traceId)" @keydown.enter="$emit('open', t.traceId)">
        <td class="name" :title="labels?.get(t.traceId) ?? t.rootSpanName">{{ labels?.get(t.traceId) ?? t.rootSpanName }}</td>
        <td class="mono id" :title="t.traceId">{{ t.traceId }}</td>
        <td class="preview" :title="t.input ?? undefined">{{ t.input ?? "–" }}</td>
        <td class="preview" :title="t.output ?? undefined">{{ t.output ?? "–" }}</td>
        <td class="muted">{{ t.serviceName }}</td>
        <td class="muted mono">{{ formatDateTime(t.startTime) }}</td>
        <td class="num mono">{{ formatDuration(t.durationMs) }}</td>
        <td class="num mono">{{ formatCount(t.spanCount) }}</td>
        <td class="num mono">{{ t.totalTokens ? formatCount(t.totalTokens) : "–" }}</td>
        <td><StatusBadge :status="t.status" :error-count="t.errorCount" /></td>
        <td v-if="showConversation">
          <a v-if="t.conversationId" class="conv-link mono" href="#" @click.prevent.stop="$emit('openConversation', t.conversationId)">{{ t.conversationId }}</a>
          <span v-else class="muted">–</span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.traces {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 12px;
  background: var(--mt-card, #fff);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.num {
  text-align: right;
}
.item {
  cursor: pointer;
}
.item:hover,
.item:focus-visible {
  background: var(--mt-soft-2);
  outline: none;
}
.item.fresh {
  animation: fade-new 3s ease-out;
}
.name {
  max-width: 380px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.muted {
  color: var(--mt-muted);
}
.id {
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mt-muted);
  font-size: 12px;
}
.preview {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mt-muted);
}
.conv-link {
  color: #c4f26b;
  font-size: 12px;
  text-decoration: none;
}
@keyframes fade-new {
  from { background: rgba(111, 207, 74, 0.3); }
}
@media (prefers-reduced-motion: reduce) {
  .item.fresh { animation: none; background: rgba(111, 207, 74, 0.16); }
}
</style>
