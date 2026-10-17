<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n";

/**
 * Un delta frente al ruido (ADR-097): la banda es lo que la diferencia debe superar para no ser azar (± el margen) y el punto
 * es el delta. Un punto fuera de la banda es un cambio real. Sin margen (no se midió) la banda va punteada y vacía.
 */
const props = defineProps<{ delta: number | null; margin: number | null; verdict: "above" | "within" | "not_measured"; tone: "ok" | "error" | "neutral" }>();

const W = 200;
const MID = W / 2;
/** El eje cubre el doble de lo mayor entre el margen y el delta, para que el punto nunca se salga del dibujo. */
const scale = computed(() => Math.max(Math.abs(props.delta ?? 0), props.margin ?? 0, 1e-9) * 1.25);
const px = (v: number) => MID + (v / scale.value) * (MID - 8);
const band = computed(() => (props.margin === null ? null : { x: px(-props.margin), w: px(props.margin) - px(-props.margin) }));
const dot = computed(() => (props.delta === null ? null : px(props.delta)));
const label = computed(() =>
  props.delta === null ? t("noiseBand.no_result_to_compare")
    : props.verdict === "above" ? t("noiseBand.difference_outside_the_noise_band")
      : props.verdict === "within" ? t("noiseBand.difference_inside_the_noise_band") : t("noiseBand.noise_not_measured"),
);
</script>

<template>
  <svg class="band" :width="W" height="30" :viewBox="`0 0 ${W} 30`" role="img" :aria-label="label">
    <line :x1="MID" :x2="MID" y1="3" y2="27" class="zero" />
    <rect v-if="band" :x="band.x" y="8" :width="band.w" height="14" rx="3" class="noise" />
    <rect v-else :x="MID - 28" y="8" width="56" height="14" rx="3" class="unknown" />
    <circle v-if="dot !== null" :cx="dot" cy="15" r="5.5" :class="['dot', tone]" />
  </svg>
</template>

<style scoped>
.band { display: block; max-width: 100%; }
.zero { stroke: var(--mt-muted); stroke-width: 1; opacity: 0.6; }
.noise { fill: var(--mt-soft); stroke: var(--mt-line); }
.unknown { fill: none; stroke: var(--mt-line); stroke-dasharray: 3 3; }
.dot { fill: var(--mt-muted); }
.dot.ok { fill: var(--mt-ok-ink); }
.dot.error { fill: var(--mt-err-ink); }
</style>
