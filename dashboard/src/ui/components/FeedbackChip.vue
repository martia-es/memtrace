<script setup lang="ts">
import { computed } from "vue";
import { feedbackTone } from "@/domain/feedback";
import ThumbIcon from "./ThumbIcon.vue";

/** Votos de usuario final de una fila: verde si gana el pulgar arriba, rojo si gana el pulgar abajo, ámbar si empatan (ADR-062). */
const props = defineProps<{ feedback?: { up: number; down: number } }>();
const tone = computed(() => feedbackTone(props.feedback?.up ?? 0, props.feedback?.down ?? 0));
</script>

<template>
  <span v-if="feedback" class="chip" :class="tone" data-testid="feedback-chip" :aria-label="`${feedback.up} positive, ${feedback.down} negative`">
    <span class="vote"><ThumbIcon direction="up" :size="13" />{{ feedback.up }}</span>
    <span class="vote"><ThumbIcon direction="down" :size="13" />{{ feedback.down }}</span>
  </span>
  <span v-else class="none">–</span>
</template>

<style scoped>
.chip { display: inline-flex; align-items: center; gap: 10px; height: 22px; padding: 0 8px; border-radius: var(--mt-radius-xs); font-size: 11.5px; font-weight: 700; white-space: nowrap; background: var(--mt-soft); color: var(--mt-muted); }
.vote { display: inline-flex; align-items: center; gap: 4px; }
.chip.ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.chip.error { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.chip.warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.none { color: var(--mt-faint); }
</style>
