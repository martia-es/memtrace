<script setup lang="ts">
/**
 * Tabla de datos única del dashboard. El contenido (<thead>/<tbody>) lo pone quien la usa, así que
 * las celdas pueden ser cualquier cosa; aquí viven la cabecera, el borde de fila y el hover.
 * - por defecto va envuelta en una caja con borde y scroll horizontal;
 * - `bare`: sin caja (ya está dentro de una tarjeta);
 * - `sticky`: cabecera fija al hacer scroll en el contenedor (implica `bare`);
 * - `density="sm"`: celdas compactas; `nowrap`: sin saltos de línea en las celdas.
 * Helpers de celda: `.num` (derecha, cifras tabulares), `.strong`, `.muted`, `.preview` (una línea con elipsis).
 * Atributos (class, data-testid…) caen sobre el <table>.
 */
defineOptions({ inheritAttrs: false });

withDefaults(defineProps<{ bare?: boolean; sticky?: boolean; density?: "md" | "sm"; nowrap?: boolean }>(), { bare: false, sticky: false, density: "md", nowrap: false });
</script>

<template>
  <div v-if="!bare && !sticky" class="mt-table-wrap">
    <table class="mt-table" :class="[`d-${density}`, { nowrap }]" v-bind="$attrs"><slot /></table>
  </div>
  <table v-else class="mt-table" :class="[`d-${density}`, { nowrap, sticky }]" v-bind="$attrs"><slot /></table>
</template>

<style scoped>
.mt-table-wrap { overflow-x: auto; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); }
.mt-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }

/* :where() deja la especificidad baja: una página puede ajustar columnas sin pelearse con la base */
:where(.mt-table) :deep(th) {
  height: 36px;
  padding: 0 14px;
  background: var(--mt-soft);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}
:where(.mt-table) :deep(td) {
  padding: 11px 14px;
  border-bottom: 1px solid var(--mt-line-2);
  color: var(--mt-ink);
  vertical-align: middle;
}
:where(.mt-table.d-sm) :deep(th) { height: 30px; padding: 0 10px; }
:where(.mt-table.d-sm) :deep(td) { padding: 6px 10px; }
:where(.mt-table.nowrap) :deep(td) { white-space: nowrap; }
:where(.mt-table.sticky) :deep(th) { position: sticky; top: 0; z-index: 1; }
:where(.mt-table) :deep(tbody tr:last-child td) { border-bottom: 0; }
:where(.mt-table) :deep(tbody tr:hover td) { background: var(--mt-soft-2); }
:where(.mt-table) :deep(th.num) { text-align: right; }
:where(.mt-table) :deep(.num) { text-align: right; font-variant-numeric: tabular-nums; }
:where(.mt-table) :deep(.strong) { font-weight: 700; }
:where(.mt-table) :deep(.muted) { color: var(--mt-muted); }
:where(.mt-table) :deep(.preview) { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
