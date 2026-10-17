<script setup lang="ts">
import type { TraceSummaryDto } from "@contract";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import type { RepoConfigDto } from "@contract";
import CommitLink from "./CommitLink.vue";
import StatusBadge from "./StatusBadge.vue";
import AnnotationChip from "./AnnotationChip.vue";
import FeedbackChip from "./FeedbackChip.vue";
import PromptChips from "./PromptChips.vue";
import DataTable from "./DataTable.vue";
import Button from "./Button.vue";
import { t } from "../i18n";

const props = defineProps<{
  items: TraceSummaryDto[];
  newKeys?: Set<string>;
  /** alternative text to the root span name (e.g., the user message) */
  labels?: Map<string, string | null | undefined>;
  showConversation?: boolean;
  /** columna con las versiones de prompt del registro que usó cada traza (ADR-068) */
  showPrompts?: boolean;
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
  <DataTable class="traces" sticky nowrap>
    <thead>
      <tr>
        <th>{{ t("traceTable.trace") }}</th>
        <th>{{ t("traceTable.input") }}</th>
        <th>{{ t("traceTable.output") }}</th>
        <th>{{ t("traceTable.start_time") }}</th>
        <th class="num">{{ t("traceTable.duration") }}</th>
        <th class="num">{{ t("traceTable.tokens") }}</th>
        <th>{{ t("traceTable.status") }}</th>
        <th v-if="ratings">{{ t("traceTable.annotation") }}</th>
        <th v-if="feedback">{{ t("traceTable.user_feedback") }}</th>
        <th v-if="showPrompts">{{ t("traceTable.prompt") }}</th>
        <th v-if="showConversation">{{ t("traceTable.conversation") }}</th>
        <th v-if="annotatable" />
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="row in items"
        :key="row.traceId"
        class="item"
        :class="{ fresh: newKeys?.has(row.traceId), selected: selectedId === row.traceId }"
        tabindex="0"
        @click="activate(row.traceId)"
        @dblclick="$emit('open', row.traceId)"
        @keydown.enter="$emit('open', row.traceId)"
      >
        <td class="name-cell">
          <span class="name" :title="labels?.get(row.traceId) ?? row.rootSpanName">{{ labels?.get(row.traceId) ?? row.rootSpanName }}</span>
          <span class="mono id" :title="row.traceId">{{ row.traceId }}</span>
          <CommitLink v-if="row.revision" :revision="row.revision" :repo="repo" data-testid="row-revision" />
        </td>
        <td class="preview" :title="row.input ?? undefined">{{ row.input ?? "–" }}</td>
        <td v-if="row.output === null && row.error" class="preview error-text" :title="row.error">{{ row.error }}</td>
        <td v-else class="preview" :title="row.output ?? undefined">{{ row.output ?? "–" }}</td>
        <td class="muted mono">{{ formatDateTime(row.startTime) }}</td>
        <td class="num mono">{{ formatDuration(row.durationMs) }}</td>
        <td class="num mono">{{ row.totalTokens ? formatCount(row.totalTokens) : "–" }}</td>
        <td><StatusBadge :status="row.status" :error-count="row.errorCount" /></td>
        <td v-if="ratings"><AnnotationChip :rating="ratings.get(row.traceId)" /></td>
        <td v-if="feedback"><FeedbackChip :feedback="feedback.get(row.traceId)" /></td>
        <td v-if="showPrompts"><PromptChips :prompts="row.prompts" :max="2" /></td>
        <td v-if="showConversation">
          <a v-if="row.conversationId" class="conv-link mono" href="#" @click.prevent.stop="$emit('openConversation', row.conversationId)">{{ row.conversationId }}</a>
          <span v-else class="muted">–</span>
        </td>
        <td v-if="annotatable"><Button size="sm" class="annotate-btn" data-testid="row-annotate" @click.stop="$emit('annotate', row.traceId)" @dblclick.stop @keydown.enter.stop>{{ t("traceTable.annotate") }}</Button></td>
      </tr>
    </tbody>
  </DataTable>
</template>

<style scoped>

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

</style>
