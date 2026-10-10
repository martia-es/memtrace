<script setup lang="ts">
/** Pestañas de una página de detalle (y de modales). Cada pestaña lleva data-testid="tab-<id>"; el slot `trailing` va al final de la barra. El estado vive en la URL (?tab=) para que se pueda enlazar y volver atrás. */
defineProps<{ tabs: { id: string; label: string; count?: number | string }[]; modelValue: string }>();
defineEmits<{ "update:modelValue": [id: string] }>();
</script>

<template>
  <div class="tab-bar" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.id"
      type="button"
      role="tab"
      class="tab"
      :class="{ active: t.id === modelValue }"
      :aria-selected="t.id === modelValue"
      :data-testid="`tab-${t.id}`"
      @click="$emit('update:modelValue', t.id)"
    >
      {{ t.label }}
      <span v-if="t.count !== undefined" class="tab-count">{{ t.count }}</span>
    </button>
    <slot name="trailing" />
  </div>
</template>

<style scoped>
.tab-bar {
  flex: none;
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--mt-line);
  overflow-x: auto;
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  border: none;
  background: transparent;
  color: var(--mt-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.tab:hover {
  color: var(--mt-ink);
}
.tab.active {
  color: var(--mt-ink);
}
.tab.active::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--mt-accent);
}
.tab-count {
  padding: 0 7px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  font-size: 11px;
  line-height: 18px;
}
</style>
