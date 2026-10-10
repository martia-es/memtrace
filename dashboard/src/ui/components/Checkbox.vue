<script setup lang="ts">
import { computed, useAttrs } from "vue";

/**
 * Casilla única del dashboard. Sin contenido en el slot es solo el control (para celdas de tabla
 * o dentro de una fila ya envuelta en <label>); con contenido envuelve control + texto en un <label>.
 * Admite v-model booleano o de array (con `value`) y también el patrón `:checked` + `@change`.
 * `variant="switch"` pinta un interruptor. Atributos (data-testid, aria-*, @change…) caen en el <input>.
 */
defineOptions({ inheritAttrs: false });

interface Props {
  modelValue?: boolean | unknown[] | null;
  value?: unknown;
  disabled?: boolean;
  variant?: "box" | "switch";
}

const props = withDefaults(defineProps<Props>(), { modelValue: undefined, value: undefined, disabled: false, variant: "box" });
const emit = defineEmits<{ "update:modelValue": [value: boolean | unknown[]] }>();

const attrs = useAttrs();
const wrapperAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
const inputAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs;
  return rest;
});

const controlled = computed(() => props.modelValue !== undefined);
const checked = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.includes(props.value) : Boolean(props.modelValue)));

function onChange(event: Event) {
  if (!controlled.value) return;
  const on = (event.target as HTMLInputElement).checked;
  if (Array.isArray(props.modelValue)) {
    const without = props.modelValue.filter((v) => v !== props.value);
    emit("update:modelValue", on ? [...without, props.value] : without);
  } else emit("update:modelValue", on);
}
</script>

<template>
  <label v-if="$slots.default" class="mt-check" :class="[`v-${variant}`, { 'is-disabled': disabled }]" v-bind="wrapperAttrs">
    <input type="checkbox" class="box" :class="{ sr: variant === 'switch' }" :checked="controlled ? checked : undefined" :disabled="disabled" @change="onChange" v-bind="inputAttrs" />
    <span v-if="variant === 'switch'" class="track" aria-hidden="true"><i /></span>
    <slot />
  </label>
  <input v-else type="checkbox" class="box" :checked="controlled ? checked : undefined" :disabled="disabled" @change="onChange" v-bind="{ ...inputAttrs, ...wrapperAttrs }" />
</template>

<style scoped>
.mt-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--mt-ink); cursor: pointer; }
.mt-check.is-disabled { opacity: 0.5; cursor: not-allowed; }
.box { margin: 0; width: 16px; height: 16px; flex: none; accent-color: var(--mt-accent); cursor: inherit; }
input.box:not(.sr) { cursor: pointer; }
.box:disabled { cursor: not-allowed; }
.box:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }

.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
.track { position: relative; width: 32px; height: 18px; flex: none; border-radius: 999px; background: var(--mt-line); transition: background 0.15s ease; }
.track i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--mt-card); transition: transform 0.15s ease; }
.sr:checked + .track { background: var(--mt-accent); }
.sr:checked + .track i { transform: translateX(14px); }
.sr:focus-visible + .track { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
</style>
