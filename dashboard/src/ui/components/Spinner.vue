<script setup lang="ts">
/** Indicador de carga propio (anillo). `size`: sm = 18 px (inline), md = 26 px, lg = 32 px (página). Hereda el color de acento. */
withDefaults(defineProps<{ size?: "sm" | "md" | "lg" }>(), { size: "md" });
</script>

<template>
  <span class="mt-spinner" :class="`s-${size}`" role="status" aria-label="Loading" />
</template>

<style scoped>
.mt-spinner {
  display: inline-block;
  box-sizing: border-box;
  border: 3px solid var(--mt-accent-soft);
  border-top-color: var(--mt-accent);
  border-radius: 50%;
  animation: mt-spin 0.8s linear infinite;
}
.s-sm { width: 18px; height: 18px; border-width: 2px; }
.s-md { width: 26px; height: 26px; }
.s-lg { width: 32px; height: 32px; }
@keyframes mt-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mt-spinner { animation-duration: 2s; } }
</style>
