<script setup lang="ts">
/**
 * Sección plegable: cabecera pulsable (slot `head`) y cuerpo (slot por defecto) visible solo si está abierta.
 * El estado lo lleva quien la usa (`open` + evento `toggle`) para poder recordarlo en la URL o en el almacenamiento.
 * `toggleTestid` va al botón de la cabecera; el resto de atributos (data-testid…) al contenedor.
 */
defineProps<{ open: boolean; toggleTestid?: string }>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <section class="mt-fold" :class="{ open }">
    <button type="button" class="head" :aria-expanded="open" :data-testid="toggleTestid" @click="$emit('toggle')">
      <slot name="head" />
      <span class="grow" />
      <span class="chev" aria-hidden="true">{{ open ? "−" : "+" }}</span>
    </button>
    <div v-if="open" class="body"><slot /></div>
  </section>
</template>

<style scoped>
.mt-fold { border-bottom: 1px solid var(--mt-line); }
.mt-fold:last-child { border-bottom: none; }
.head {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.head:hover { background: var(--mt-bg); }
.head:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: -2px; }
.grow { flex: 1; }
.chev { color: var(--mt-muted); font-family: var(--mt-mono); }
.body { padding-bottom: 8px; }
</style>
