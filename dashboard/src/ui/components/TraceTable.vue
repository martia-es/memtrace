<script setup lang="ts">
import type { TraceSummaryDto } from "@contract";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import type { RepoConfigDto } from "@contract";
import CommitLink from "./CommitLink.vue";
import StatusBadge from "./StatusBadge.vue";
import AnnotationChip from "./AnnotationChip.vue";
import FeedbackChip from "./FeedbackChip.vue";

const props = defineProps<{
  items: TraceSummaryDto[];
  newKeys?: Set<string>;
  /** alternative text to the root span name (e.g., the user message) */
  labels?: Map<string, string | null | undefined>;
  showConversation?: boolean;
  /** con `selectable`, un clic selecciona (vista previa) y abrir exige doble clic o Enter */
  selectable?: boolean;
  selectedId?: string | null;
  /** muestra un botón Annotate por fila (p. ej. en el detalle de una conversación) */
  annotatable?: boolean;
  /** con `ratings` aparece la columna Annotation; una traza sin entrada no tiene etiquetas humanas */
  ratings?: Map<string, { labels: number; low: boolean }>;
  /** con `feedback` aparece la columna User feedback (👍/👎 de usuario final, ADR-062) */
  feedback?: Map<string, { up: number; down: number }>;
  /** repositorio del agente: con él, la versión de cada traza enlaza a su commit (ADR-065) */
  repo?: RepoConfigDto | null;
}>();
const emit = defineEmits<{ open: [traceId: string]; select: [traceId: string]; openConversation: [conversationId: string]; annotate: [traceId: string] }>();

const activate = (traceId: string) => (props.selectable ? emit("select", traceId) : emit("open", traceId));
</script>

<template>
  <table class="traces">
    <thead>
      <tr>
        <th>Trace</th>
        <th>Input</th>
        <th>Output</th>
        <th>Start time</th>
        <th class="num">Duration</th>
        <th class="num">Tokens</th>
        <th>Status</th>
        <th v-if="ratings">Annotation</th>
        <th v-if="feedback">User feedback</th>
        <th v-if="showConversation">Conversation</th>
        <th v-if="annotatable" />
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="t in items"
        :key="t.traceId"
        class="item"
        :class="{ fresh: newKeys?.has(t.traceId), selected: selectedId === t.traceId }"
        tabindex="0"
        @click="activate(t.traceId)"
        @dblclick="$emit('open', t.traceId)"
        @keydown.enter="$emit('open', t.traceId)"
      >
        <td class="name-cell">
          <span class="name" :title="labels?.get(t.traceId) ?? t.rootSpanName">{{ labels?.get(t.traceId) ?? t.rootSpanName }}</span>
          <span class="mono id" :title="t.traceId">{{ t.traceId }}</span>
          <CommitLink v-if="t.revision" :revision="t.revision" :repo="repo" data-testid="row-revision" />
        </td>
        <td class="preview" :title="t.input ?? undefined">{{ t.input ?? "–" }}</td>
        <td v-if="t.output === null && t.error" class="preview error-text" :title="t.error">{{ t.error }}</td>
        <td v-else class="preview" :title="t.output ?? undefined">{{ t.output ?? "–" }}</td>
        <td class="muted mono">{{ formatDateTime(t.startTime) }}</td>
        <td class="num mono">{{ formatDuration(t.durationMs) }}</td>
        <td class="num mono">{{ t.totalTokens ? formatCount(t.totalTokens) : "–" }}</td>
        <td><StatusBadge :status="t.status" :error-count="t.errorCount" /></td>
        <td v-if="ratings"><AnnotationChip :rating="ratings.get(t.traceId)" /></td>
        <td v-if="feedback"><FeedbackChip :feedback="feedback.get(t.traceId)" /></td>
        <td v-if="showConversation">
          <a v-if="t.conversationId" class="conv-link mono" href="#" @click.prevent.stop="$emit('openConversation', t.conversationId)">{{ t.conversationId }}</a>
          <span v-else class="muted">–</span>
        </td>
        <td v-if="annotatable"><button type="button" class="annotate-btn" data-testid="row-annotate" @click.stop="$emit('annotate', t.traceId)" @dblclick.stop @keydown.enter.stop>Annotate</button></td>
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
  padding: 0 12px;
  height: 34px;
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
  padding: 0 12px;
  height: 46px;
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
.item.selected {
  background: var(--mt-accent-tint);
  box-shadow: inset 3px 0 0 var(--mt-accent);
}
.item.fresh {
  animation: fade-new 3s ease-out;
}
.name-cell {
  max-width: 230px;
}
.name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 700;
}
.id {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mt-faint);
  font-size: 11.5px;
  font-weight: 400;
}
.muted {
  color: var(--mt-muted);
}
.mono {
  font-size: 12px;
  font-weight: 400;
}
.preview {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--mt-muted);
}
.preview.error-text {
  color: var(--mt-error, #c0242b);
}
.conv-link {
  color: var(--mt-accent-text);
  font-size: 12px;
  text-decoration: none;
}
.conv-link:hover {
  text-decoration: underline;
}
@keyframes fade-new {
  from { background: var(--mt-accent-soft); }
}
@media (prefers-reduced-motion: reduce) {
  .item.fresh { animation: none; background: var(--mt-accent-tint); }
}
.annotate-btn {
  height: 24px;
  padding: 0 10px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
}
</style>
