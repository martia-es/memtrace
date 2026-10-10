<script setup lang="ts">
/** Opción de un `Menu` (con `href`, enlace externo en pestaña nueva). `active` la marca como elegida (y la anuncia con aria-pressed); `danger` para acciones destructivas. */
withDefaults(defineProps<{ active?: boolean; danger?: boolean; disabled?: boolean; href?: string }>(), { active: undefined, danger: false, disabled: false, href: undefined });
</script>

<template>
  <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer" role="menuitem" class="mt-menu-item"><slot /></a>
  <button v-else type="button" role="menuitem" class="mt-menu-item" :class="{ active, danger }" :aria-pressed="active" :disabled="disabled"><slot /></button>
</template>

<style scoped>
.mt-menu-item {
  box-sizing: border-box;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: 0;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.mt-menu-item:hover:not(:disabled) { background: var(--mt-soft); }
.mt-menu-item:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: -2px; }
.mt-menu-item.active { background: var(--mt-accent-tint); color: var(--mt-accent-text); font-weight: 700; }
.mt-menu-item.danger { color: var(--mt-err-ink); }
.mt-menu-item:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
