<script setup lang="ts">
import { computed } from "vue";
import { conversationTurns } from "@/domain/review-thread";
import { traceThread } from "@/domain/trace-thread";
import ConversationThread from "./ConversationThread.vue";
import ErrorBanner from "./ErrorBanner.vue";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";

/** La conversación de una traza leída como un chat, para ver qué se evaluó sin salir de la pantalla (ADR-050). */
const props = defineProps<{ traceId: string }>();

const api = useTraceApi();
const trace = useAsync((signal) => api.getTrace(props.traceId, signal));
void trace.run();
const turns = computed(() => conversationTurns(traceThread(trace.data.value?.roots ?? [])));
</script>

<template>
  <div class="preview" data-testid="trace-preview">
    <ErrorBanner v-if="trace.error.value" :error="trace.error.value" @retry="trace.run()" />
    <div v-else-if="!trace.data.value" class="loading"><q-spinner size="20px" color="primary" /></div>
    <p v-else-if="!turns.length" class="empty">This trace has no content saved.</p>
    <ConversationThread v-else :turns="turns" answer-label="Reply that was reviewed" />
  </div>
</template>

<style scoped>
.preview {
  max-height: 320px;
  overflow: auto;
  margin-bottom: 8px;
  padding: 8px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 12px;
}
.empty {
  margin: 0;
  color: var(--mt-muted);
  font-size: 12.5px;
}
</style>
