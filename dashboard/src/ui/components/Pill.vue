<script setup lang="ts">
/**
 * Etiqueta compacta única del dashboard (estados, deltas, roles, tags). El color comunica estado:
 * ok / error / warn / info / highlight; `accent` es el énfasis sólido de la organización y
 * `neutral` el valor por defecto. `dot` antepone un punto (chip de estado, ADR-048).
 * La clase raíz sigue siendo `mt-pill` para que las páginas puedan afinar variantes locales.
 */
interface Props {
  tone?: "neutral" | "ok" | "error" | "warn" | "info" | "highlight" | "accent";
  outline?: boolean;
  mono?: boolean;
  dot?: boolean;
}

withDefaults(defineProps<Props>(), { tone: "neutral", outline: false, mono: false, dot: false });
</script>

<template>
  <span class="mt-pill" :class="[`t-${tone}`, { outline, mono, 'with-dot': dot }]">
    <span v-if="dot" class="dot" aria-hidden="true" />
    <slot />
  </span>
</template>

<style scoped>
.mt-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  font-size: 11.5px;
  font-weight: 700;
  white-space: nowrap;
}
.mt-pill.with-dot { height: 22px; padding: 0 8px; gap: 6px; }
.mt-pill.mono { font-family: var(--mt-mono); }
.mt-pill.outline { background: transparent; border: 1px solid var(--mt-line-2); }
.with-dot > .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

/* :where() mantiene la especificidad baja: las variantes locales de cada página siempre ganan */
.mt-pill:where(.t-neutral) { background: var(--mt-soft); color: var(--mt-muted); }
.mt-pill:where(.t-ok) { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.mt-pill:where(.t-error) { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.mt-pill:where(.t-warn) { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.mt-pill:where(.t-info) { background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.mt-pill:where(.t-highlight) { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.mt-pill:where(.t-accent) { background: var(--mt-accent); color: var(--mt-accent-ink); }
.mt-pill.outline:where(.t-neutral, .t-ok, .t-error, .t-warn, .t-info, .t-highlight, .t-accent) { background: transparent; }
</style>
