<script setup lang="ts">
/**
 * Superficie base del dashboard: fondo de tarjeta, borde fino y radio. Es una columna flex para que
 * cabecera y cuerpo se apilen con `gap`. Los atributos (class, data-testid, aria-*) caen en la raíz.
 * - `padding`: `md` (por defecto), `sm`, `lg` o `none` (contenido a sangre: tablas, listas con filas propias);
 * - `gap`: separación entre hijos (`none`, `sm`, `md`);
 * - `tone="danger"`: borde de error; `as`: etiqueta HTML (section, li, article…).
 */
withDefaults(defineProps<{ as?: string; padding?: "none" | "sm" | "md" | "lg"; gap?: "none" | "sm" | "md"; tone?: "default" | "danger" }>(), {
  as: "div",
  padding: "md",
  gap: "none",
  tone: "default",
});
</script>

<template>
  <component :is="as" class="mt-card" :class="[`p-${padding}`, `g-${gap}`, { danger: tone === 'danger' }]"><slot /></component>
</template>

<style scoped>
/* :where() mantiene la especificidad baja: la página puede ajustar su tarjeta con una clase local */
:where(.mt-card) {
  display: flex;
  flex-direction: column;
  min-width: 0;
  box-sizing: border-box;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
}
:where(.mt-card.danger) { border-color: var(--mt-err); }
:where(.mt-card.p-sm) { padding: 12px 14px; }
:where(.mt-card.p-md) { padding: 14px 16px; }
:where(.mt-card.p-lg) { padding: 18px 20px; }
:where(.mt-card.g-sm) { gap: 8px; }
:where(.mt-card.g-md) { gap: 12px; }
</style>
