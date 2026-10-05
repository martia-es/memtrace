<script setup lang="ts">
/** Chip de estado del diseño (ADR-048): punto + etiqueta sobre fondo suave; el color solo comunica estado. */
withDefaults(defineProps<{ tone?: "ok" | "error" | "warn" | "info" | "neutral"; label: string }>(), { tone: "neutral" });
</script>

<template>
  <span class="chip" :class="tone"><span class="dot" aria-hidden="true" />{{ label }}</span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--mt-radius-xs);
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
.chip.ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.chip.error { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.chip.warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.chip.info { background: var(--mt-accent-soft); color: var(--mt-accent-text); }
</style>
