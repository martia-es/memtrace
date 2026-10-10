<script setup lang="ts">
/**
 * Chip conmutable (filtro, selección de pasos, pregunta sugerida). `pressed` lo marca como activo y se anuncia
 * con aria-pressed; `count` pinta una cifra secundaria. Atributos y @click caen sobre el <button>.
 */
withDefaults(defineProps<{ pressed?: boolean; count?: number | string }>(), { pressed: false, count: undefined });
</script>

<template>
  <button type="button" class="mt-chip" :class="{ on: pressed }" :aria-pressed="pressed">
    <slot />
    <span v-if="count !== undefined" class="n">{{ count }}</span>
  </button>
</template>

<style scoped>
.mt-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--mt-line);
  border-radius: 999px;
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}
.mt-chip:hover { border-color: var(--mt-muted); }
.mt-chip:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
.mt-chip.on { background: var(--mt-accent); border-color: var(--mt-accent); color: var(--mt-accent-ink); }
.n { color: var(--mt-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.on .n { color: inherit; opacity: 0.8; }
</style>
