<script setup lang="ts">
/**
 * Campo de formulario: etiqueta + control (slot) + pista y error opcionales. Al ser un <label>
 * que envuelve el control, la etiqueta queda asociada sin necesidad de `for`/`id`.
 * Los atributos (class, data-testid…) caen sobre el <label>.
 */
withDefaults(defineProps<{ label: string; hint?: string; error?: string | null; as?: "label" | "div" }>(), { hint: undefined, error: undefined, as: "label" });
</script>

<template>
  <component :is="as" class="mt-field">
    <span class="lbl">{{ label }}</span>
    <slot />
    <span v-if="hint && !error" class="hint">{{ hint }}</span>
    <span v-if="error" class="err" role="alert">{{ error }}</span>
  </component>
</template>

<style scoped>
.mt-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.lbl { font-size: 12px; font-weight: 700; color: var(--mt-muted); }
.hint { font-size: 12px; color: var(--mt-muted); }
.err { font-size: 12px; font-weight: 600; color: var(--mt-err-ink); }
</style>
