<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { TraceFeedbackResponse } from "@contract";
import { alignmentLabel, feedbackTone } from "@/domain/feedback";
import { formatDateTime } from "@/domain/format";
import ThumbIcon from "./ThumbIcon.vue";
import { useTraceApi } from "../composables/useTraceApi";
import Card from "./Card.vue";

/**
 * Lo que el usuario final dijo de esta respuesta (👍/👎, ADR-062), con una franja de color y si coincide con la
 * revisión humana. No pinta nada si nadie votó o si la carga falla: es información añadida, no esencial.
 */
const props = defineProps<{ traceId: string; refreshKey?: number }>();

const api = useTraceApi();
const feedback = ref<TraceFeedbackResponse | null>(null);

async function load() {
  feedback.value = await api.getTraceFeedback(props.traceId).catch(() => null);
}
watch(() => [props.traceId, props.refreshKey], () => void load(), { immediate: true });

const votes = computed(() => feedback.value?.votes ?? []);
const up = computed(() => votes.value.filter((v) => v.rating === 1).length);
const down = computed(() => votes.value.length - up.value);
const tone = computed(() => feedbackTone(up.value, down.value));
const alignment = computed(() => (feedback.value ? alignmentLabel(feedback.value.alignment) : null));
const comments = computed(() => votes.value.filter((v) => v.comment));
</script>

<template>
  <Card as="section" padding="none" block v-if="votes.length" class="strip" :class="tone" aria-label="User feedback" data-testid="trace-feedback">
    <div class="line">
      <span class="verdict" aria-hidden="true"><ThumbIcon :direction="tone === 'error' ? 'down' : 'up'" :size="18" filled /></span>
      <b>User feedback</b>
      <span class="counts mono" :aria-label="`${up} positive, ${down} negative`">
        <span class="count"><ThumbIcon direction="up" :size="13" />{{ up }}</span>
        <span class="count"><ThumbIcon direction="down" :size="13" />{{ down }}</span>
      </span>
      <span v-if="alignment" class="align" :class="feedback?.alignment" data-testid="feedback-alignment">{{ alignment }}</span>
    </div>
    <ul v-if="comments.length" class="comments">
      <li v-for="(v, i) in comments" :key="i">“{{ v.comment }}” <span class="when mono">{{ formatDateTime(v.createdAt) }}</span></li>
    </ul>
  </Card>
</template>

<style scoped>
.strip { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-left: 4px solid var(--mt-line); font-size: 13px; }
.strip.ok { border-left-color: var(--mt-ok); }
.strip.error { border-left-color: var(--mt-err); }
.strip.warn { border-left-color: var(--mt-warn, #d97706); }
.line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.verdict { display: inline-flex; }
.strip.ok .verdict { color: var(--mt-ok-ink); }
.strip.error .verdict { color: var(--mt-err-ink); }
.strip.warn .verdict { color: var(--mt-warn-ink); }
.counts { display: inline-flex; gap: 12px; color: var(--mt-muted); }
.count { display: inline-flex; align-items: center; gap: 4px; }
.align { padding: 2px 8px; font-size: 11.5px; font-weight: 700; border-radius: var(--mt-radius-xs); background: var(--mt-soft); color: var(--mt-muted); }
.align.aligned { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.align.misaligned { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.comments { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; color: var(--mt-ink); }
.when { margin-left: 6px; font-size: 11px; color: var(--mt-faint); }
</style>
