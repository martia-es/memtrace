<script setup lang="ts">
import { computed } from "vue";
import { feedbackTone } from "@/domain/feedback";
import ThumbIcon from "./ThumbIcon.vue";
import Pill from "./Pill.vue";

/** Votos de usuario final de una fila: verde si gana el pulgar arriba, rojo si gana el pulgar abajo, ámbar si empatan (ADR-062). */
const props = defineProps<{ feedback?: { up: number; down: number } }>();
const tone = computed(() => feedbackTone(props.feedback?.up ?? 0, props.feedback?.down ?? 0));
</script>

<template>
  <Pill v-if="feedback" :tone="tone" data-testid="feedback-chip" :aria-label="`${feedback.up} positive, ${feedback.down} negative`">
    <span class="vote"><ThumbIcon direction="up" :size="13" />{{ feedback.up }}</span>
    <span class="vote"><ThumbIcon direction="down" :size="13" />{{ feedback.down }}</span>
  </Pill>
  <span v-else class="none">–</span>
</template>

<style scoped>
.vote { display: inline-flex; align-items: center; gap: 4px; }
.none { color: var(--mt-faint); }
</style>
