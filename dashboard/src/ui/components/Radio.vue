<script setup lang="ts">
import { computed, useAttrs } from "vue";

/**
 * Opción de radio del dashboard. Con contenido en el slot envuelve control + texto en un <label>;
 * sin él es solo el control. v-model con `value`; el resto de atributos (name, data-testid…) van al <input>.
 */
defineOptions({ inheritAttrs: false });

interface Props {
  modelValue?: unknown;
  value: unknown;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), { modelValue: undefined, disabled: false });
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();

const attrs = useAttrs();
const wrapperAttrs = computed(() => ({ class: attrs.class, style: attrs.style }));
const inputAttrs = computed(() => {
  const { class: _c, style: _s, ...rest } = attrs;
  return rest;
});
</script>

<template>
  <label v-if="$slots.default" class="mt-radio" :class="{ disabled }" v-bind="wrapperAttrs">
    <input type="radio" class="dot" :checked="modelValue === value" :value="value as string" :disabled="disabled" @change="emit('update:modelValue', value)" v-bind="inputAttrs" />
    <slot />
  </label>
  <input v-else type="radio" class="dot" :checked="modelValue === value" :value="value as string" :disabled="disabled" @change="emit('update:modelValue', value)" v-bind="{ ...inputAttrs, ...wrapperAttrs }" />
</template>

<style scoped>
.mt-radio { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--mt-ink); cursor: pointer; }
.mt-radio.disabled { opacity: 0.5; cursor: not-allowed; }
.dot { margin: 0; width: 16px; height: 16px; flex: none; accent-color: var(--mt-accent); cursor: pointer; }
.dot:disabled { cursor: not-allowed; }
.dot:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
</style>
