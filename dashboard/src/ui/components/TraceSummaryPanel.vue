<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AnnotationDto, TraceAnnotationsResponse, TraceQueueDto } from "@contract";
import { shortId } from "@/domain/format";
import { useTraceApi } from "../composables/useTraceApi";

/**
 * Resumen de solo lectura de todo lo que la traza tiene asociado (ADR-037, ADR-039): etiquetas humanas,
 * evaluaciones automáticas (solo si la traza es item de un run) y colas de revisión. Se edita desde el modal Annotate; si una carga falla, su sección se omite.
 */
const props = defineProps<{ traceId: string; refreshKey?: number }>();

const api = useTraceApi();
const judgments = ref<TraceAnnotationsResponse | null>(null);
const queues = ref<TraceQueueDto[] | null>(null);

async function load() {
  [judgments.value, queues.value] = await Promise.all([
    api.listTraceAnnotations(props.traceId).catch(() => null),
    api.listTraceQueues(props.traceId).then((r) => r.items).catch(() => null),
  ]);
}
watch(() => [props.traceId, props.refreshKey], () => void load(), { immediate: true });

const annotations = computed(() => judgments.value?.annotations ?? []);
const scores = computed(() => judgments.value?.scores ?? []);
const authorOf = (a: AnnotationDto) => a.annotator.name ?? "Former member";
const scopeOf = (a: AnnotationDto) => (a.spanId ? `span ${shortId(a.spanId)}` : null);
const queueStatus = (q: TraceQueueDto) => (q.itemStatus === "skipped" ? "unreviewable" : q.itemStatus);
</script>

<template>
  <aside class="summary" aria-label="Trace summary" data-testid="trace-summary">
    <section v-if="judgments" class="mt-card block" aria-label="Human labels">
      <h2>Human labels</h2>
      <p v-if="!annotations.length" class="empty" data-testid="trace-not-annotated">Not annotated yet.</p>
      <ul v-else>
        <li v-for="a in annotations" :key="`${a.configId}|${a.spanId}|${a.annotator.id}`" data-testid="trace-label">
          <div class="line">
            <span class="name">{{ a.configName }}</span>
            <span class="value mono">{{ a.value }}</span>
          </div>
          <span class="by">{{ authorOf(a) }}<template v-if="scopeOf(a)"> · {{ scopeOf(a) }}</template></span>
          <span v-if="a.comment" class="comment">“{{ a.comment }}”</span>
        </li>
      </ul>
    </section>

    <section v-if="scores.length" class="mt-card block" aria-label="Automatic evaluations">
      <h2>Evaluations</h2>
      <ul>
        <li v-for="(s, i) in scores" :key="i" data-testid="trace-score">
          <div class="line">
            <span class="name">{{ s.name }}</span>
            <span class="value mono">{{ s.value }}</span>
          </div>
          <span class="by">{{ s.source }}</span>
          <span v-if="s.comment" class="comment">“{{ s.comment }}”</span>
        </li>
      </ul>
    </section>

    <section v-if="queues" class="mt-card block" aria-label="Review queues">
      <h2>Review queues</h2>
      <p v-if="!queues.length" class="empty" data-testid="trace-no-queues">Not in any queue.</p>
      <ul v-else>
        <li v-for="q in queues" :key="q.queueId" data-testid="trace-queue">
          <div class="line">
            <router-link :to="{ name: 'annotation-queues' }" class="name link">{{ q.queueName }}</router-link>
            <span class="value">{{ queueStatus(q) }}</span>
          </div>
          <span v-if="q.archived" class="by">archived</span>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
.block {
  padding: 12px 14px;
}
h2 {
  margin: 0 0 8px;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.empty {
  margin: 0;
  color: var(--mt-muted);
  font-size: 12.5px;
}
ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12.5px;
}
.line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.name {
  font-weight: 700;
  overflow-wrap: anywhere;
}
.link {
  color: var(--mt-accent-text);
  text-decoration: none;
}
.value {
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
  font-weight: 700;
  white-space: nowrap;
}
.by,
.comment {
  color: var(--mt-muted);
  overflow-wrap: anywhere;
}
</style>
