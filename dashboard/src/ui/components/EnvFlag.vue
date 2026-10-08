<script setup lang="ts">
/** Etiqueta de un tag de entorno: dev en neutro, pre en ámbar, pro en el color de acción; cualquier otro, sobrio. */
defineProps<{ env: string }>();
</script>

<template>
  <span class="env-flag" :class="env === 'dev' || env === 'pre' || env === 'pro' ? env : 'other'">{{ env }}</span>
</template>

<style scoped>
.env-flag {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: var(--mt-radius-xs);
  font-family: var(--mt-mono);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.dev,
.other {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.pre {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
.pro {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
</style>
