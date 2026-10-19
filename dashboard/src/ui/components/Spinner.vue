<script setup lang="ts">
import { t } from "../i18n";
/**
 * Indicador de carga propio: el logo de MemTrace "destilando" trazas en conocimiento. Tres trazas (turquesa)
 * se escriben, se juntan y se funden en una barra coral.
 * `size`: sm = 18 px (inline), md = 36 px, lg = 64 px (página).
 * `tone`: `brand` pinta el logo con sus colores, turquesa y coral, directamente sobre el fondo (por defecto);
 * `current` usa solo el color del texto, para ir dentro de botones y controles.
 */
withDefaults(defineProps<{ size?: "sm" | "md" | "lg"; tone?: "brand" | "current" }>(), { size: "md", tone: "brand" });
</script>

<template>
  <span class="mt-spinner" :class="[`s-${size}`, `tone-${tone}`]" role="status" :aria-label="t('spinner.loading')">
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect class="b b1" x="5" y="7" width="15" height="5" rx="2.5" />
      <rect class="b b2t" x="10" y="14" width="18" height="5" rx="2.5" />
      <rect class="b b2k" x="10" y="14" width="18" height="5" rx="2.5" />
      <rect class="b b3" x="7" y="21" width="12" height="5" rx="2.5" fill-opacity="0.5" />
    </svg>
  </span>
</template>

<style scoped>
/*
 * Compatible con Safari: colores fijos (sin var() dentro de @keyframes, sin animar `fill`), orígenes de
 * transformación en unidades del viewBox (sin transform-box) y barras visibles por defecto, de modo que si la
 * animación no corre se ve el logo quieto y no una baldosa vacía. La barra central son dos capas (turquesa y
 * coral) que se funden por opacidad.
 */
.mt-spinner { display: inline-flex; flex: none; line-height: 0; }
.mt-spinner svg { width: 100%; height: 100%; display: block; }
.s-sm { width: 18px; height: 18px; }
.s-md { width: 36px; height: 36px; }
.s-lg { width: 64px; height: 64px; }

.b {
  fill: #00b3ad;
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.45, 0, 0.25, 1);
  animation-iteration-count: infinite;
}
.b2k { fill: #ff6b4a; opacity: 0; }
.tone-current .b { fill: currentColor; }

.b1 { transform-origin: 5px 9.5px; animation-name: mt-distill-1; }
.b2t { transform-origin: 10px 16.5px; animation-name: mt-distill-2t; }
.b2k { transform-origin: 10px 16.5px; animation-name: mt-distill-2k; }
.b3 { transform-origin: 7px 23.5px; animation-name: mt-distill-3; }

@keyframes mt-distill-1 {
  0% { transform: translateY(0) scaleX(0); opacity: 1; }
  16%, 30% { transform: translateY(0) scaleX(1); opacity: 1; }
  55%, 100% { transform: translateY(7px) scaleX(1); opacity: 0; }
}
@keyframes mt-distill-3 {
  0%, 8% { transform: translateY(0) scaleX(0); opacity: 1; }
  24%, 30% { transform: translateY(0) scaleX(1); opacity: 1; }
  55%, 100% { transform: translateY(-7px) scaleX(1); opacity: 0; }
}
@keyframes mt-distill-2t {
  0%, 4% { transform: scaleX(0); opacity: 1; }
  20%, 50% { transform: scaleX(1); opacity: 1; }
  55%, 100% { transform: scaleX(1); opacity: 0; }
}
@keyframes mt-distill-2k {
  0%, 50% { transform: scaleX(1) scaleY(1); opacity: 0; }
  55% { transform: scaleX(1) scaleY(1); opacity: 1; }
  63% { transform: scaleX(1) scaleY(1.45); opacity: 1; }
  72%, 88% { transform: scaleX(1) scaleY(1); opacity: 1; }
  100% { transform: scaleX(1) scaleY(1); opacity: 0; }
}

/* Con movimiento reducido se ve el logo terminado, quieto. */
@media (prefers-reduced-motion: reduce) {
  .b { animation: none; opacity: 1; transform: none; }
  .b2t { opacity: 0; }
}
</style>
