<script setup lang="ts">
/**
 * Selector segmentado: grupo de botones del que se elige uno (`v-model` = valor) o varios (`multiple`,
 * `v-model` = array). Cada botón expone `aria-pressed`. Una opción puede llevar `count`, `testid` y `class`.
 * Con `role="tablist"` (prop `tabs`) se anuncia como pestañas en lugar de grupo.
 */
export interface SegmentOption {
  value: string | number | null;
  label: string;
  count?: number | string;
  disabled?: boolean;
  testid?: string;
  class?: string;
}

const props = withDefaults(defineProps<{ options: SegmentOption[]; modelValue: unknown; multiple?: boolean; size?: "md" | "sm"; disabled?: boolean; ariaLabel?: string; tabs?: boolean }>(), {
  multiple: false,
  size: "md",
  disabled: false,
  ariaLabel: undefined,
  tabs: false,
});
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();

const isOn = (v: SegmentOption["value"]) => (props.multiple && Array.isArray(props.modelValue) ? props.modelValue.includes(v) : props.modelValue === v);
function pick(v: SegmentOption["value"]) {
  if (!props.multiple) return emit("update:modelValue", v);
  const cur = Array.isArray(props.modelValue) ? props.modelValue : [];
  emit("update:modelValue", cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
}
</script>

<template>
  <div class="mt-segmented" :class="{ small: size === 'sm' }" :role="tabs ? 'tablist' : 'group'" :aria-label="ariaLabel">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      :class="o.class"
      :role="tabs ? 'tab' : undefined"
      :aria-pressed="isOn(o.value)"
      :aria-selected="tabs ? isOn(o.value) : undefined"
      :disabled="disabled || o.disabled"
      :data-testid="o.testid"
      @click="pick(o.value)"
    >
      <slot name="option" :option="o">{{ o.label }}</slot>
      <span v-if="o.count !== undefined" class="mono count">{{ o.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.mt-segmented { display: inline-flex; gap: 2px; padding: 4px; border-radius: var(--mt-radius-sm); background: var(--mt-soft); }
.mt-segmented.small { padding: 3px; }
button {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--mt-radius-sm);
  background: transparent;
  color: var(--mt-muted);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.small button { height: 24px; padding: 0 10px; border-radius: var(--mt-radius-xs); font-size: 11.5px; }
button:hover:not(:disabled) { color: var(--mt-ink); }
button[aria-pressed="true"] { background: var(--mt-card); color: var(--mt-ink); box-shadow: 0 0 0 1px var(--mt-line); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 1px; }
.count { font-size: 11px; font-weight: 500; opacity: 0.75; }
</style>
