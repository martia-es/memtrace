<script setup lang="ts">
import { t } from "../i18n";
/**
 * Indicador de carga propio: el logo de MemTrace "destilando" trazas en conocimiento. Tres trazas (turquesa)
 * se escriben, se juntan y se funden en una barra coral.
 * `size`: sm = 18 px (inline), md = 36 px, lg = 64 px (página).
 * `tone`: `brand` pinta el logo con sus colores sobre su baldosa verde (por defecto); `current` usa solo el color
 * del texto, sin baldosa, para ir dentro de botones y controles.
 */
withDefaults(defineProps<{ size?: "sm" | "md" | "lg"; tone?: "brand" | "current" }>(), { size: "md", tone: "brand" });
</script>

<template>
  <span class="mt-spinner" :class="[`s-${size}`, `tone-${tone}`]" role="status" :aria-label="t('spinner.loading')">
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect v-if="tone === 'brand'" class="tile" width="32" height="32" rx="7" />
      <rect class="b b1" x="5" y="7" width="15" height="5" rx="2.5" />
      <rect class="b b2" x="10" y="14" width="18" height="5" rx="2.5" />
      <rect class="b b3" x="7" y="21" width="12" height="5" rx="2.5" />
    </svg>
  </span>
</template>

<style scoped>
.mt-spinner {
  --l-trace: #00b3ad;
  --l-know: #ff6b4a;
  display: inline-flex;
  flex: none;
  line-height: 0;
}
.mt-spinner.tone-current { --l-trace: currentColor; --l-know: currentColor; }
.mt-spinner svg { width: 100%; height: 100%; display: block; }
.s-sm { width: 18px; height: 18px; }
.s-md { width: 36px; height: 36px; }
.s-lg { width: 64px; height: 64px; }

.tile { fill: #0a2321; }
.b {
  transform-box: fill-box;
  transform-origin: 0 50%;
  opacity: 0;
  fill: var(--l-trace);
  animation-duration: 2.8s;
  animation-timing-function: cubic-bezier(0.45, 0, 0.25, 1);
  animation-iteration-count: infinite;
}
.b1 { animation-name: mt-distill-1; }
.b2 { animation-name: mt-distill-2; }
.b3 { animation-name: mt-distill-3; fill-opacity: 0.5; }

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
@keyframes mt-distill-2 {
  0%, 4% { transform: scaleX(0) scaleY(1); fill: var(--l-trace); opacity: 1; }
  20%, 30% { transform: scaleX(1) scaleY(1); fill: var(--l-trace); }
  55% { transform: scaleX(1) scaleY(1); fill: var(--l-know); }
  63% { transform: scaleX(1) scaleY(1.45); fill: var(--l-know); }
  72%, 88% { transform: scaleX(1) scaleY(1); fill: var(--l-know); opacity: 1; }
  100% { transform: scaleX(1) scaleY(1); fill: var(--l-know); opacity: 0; }
}

/* Con movimiento reducido se ve el logo terminado, quieto. */
@media (prefers-reduced-motion: reduce) {
  .b { animation: none; opacity: 1; transform: none; }
  .b2 { fill: var(--l-know); }
}
</style>
