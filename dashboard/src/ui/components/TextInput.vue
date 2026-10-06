<script setup lang="ts">
import { computed, ref } from "vue";

defineOptions({ inheritAttrs: false });

interface Props {
  modelValue: string | number | null | undefined;
  type?: "text" | "number" | "email" | "search" | "url";
  /** Renders a <textarea> instead of an <input>. */
  multiline?: boolean;
  rows?: number;
  invalid?: boolean;
  /** Search type only: shows a clear button while there is text. */
  clearable?: boolean;
  /** Monospace font, for ids, service names and claims. */
  mono?: boolean;
  /** `sm` for compact controls (inline filters, table cells). */
  size?: "md" | "sm";
}

const props = withDefaults(defineProps<Props>(), {
  type: "text",
  multiline: false,
  rows: 3,
  invalid: false,
  clearable: true,
  mono: false,
  size: "md",
});

const emit = defineEmits<{ "update:modelValue": [value: string | number]; enter: []; escape: [] }>();

const control = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

const isSearch = computed(() => props.type === "search" && !props.multiline);
const showClear = computed(() => isSearch.value && props.clearable && String(props.modelValue ?? "") !== "");

const onInput = (event: Event) => {
  const raw = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  if (props.type === "number") {
    const n = parseFloat(raw);
    emit("update:modelValue", Number.isNaN(n) ? raw : n);
  } else {
    emit("update:modelValue", raw);
  }
};

const clear = () => {
  emit("update:modelValue", "");
  control.value?.focus();
};

defineExpose({ focus: () => control.value?.focus() });
</script>

<template>
  <div class="ti" :class="[`ti-${size}`, { 'ti-invalid': invalid, 'ti-mono': mono, 'ti-search': isSearch }, $attrs.class]" :style="$attrs.style as any">
    <svg v-if="isSearch" class="ti-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
    <textarea
      v-if="multiline"
      ref="control"
      @input="onInput"
      v-bind="{ ...$attrs, class: undefined, style: undefined }"
      class="ti-control ti-area"
      :rows="rows"
      :value="modelValue ?? ''"
      :aria-invalid="invalid || undefined"
      @keydown.escape="emit('escape')"
    />
    <input
      v-else
      ref="control"
      @input="onInput"
      v-bind="{ ...$attrs, class: undefined, style: undefined }"
      class="ti-control"
      :type="type"
      :value="modelValue ?? ''"
      :aria-invalid="invalid || undefined"
      @keydown.enter="emit('enter')"
      @keydown.escape="emit('escape')"
    />
    <button v-if="showClear" type="button" class="ti-clear" aria-label="Clear" @click="clear">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.ti {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
}

.ti-control {
  box-sizing: border-box;
  width: 100%;
  height: 36px;
  padding: 0 12px;
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  transition: border-color 0.15s ease;
}

.ti-sm .ti-control {
  height: 30px;
  padding: 0 8px;
  font-size: 12px;
}

.ti-area {
  height: auto;
  padding: 8px 12px;
  resize: vertical;
  line-height: 1.45;
}

.ti-mono .ti-control {
  font-family: var(--mt-mono);
}

.ti-control::placeholder {
  color: var(--mt-muted);
  font-weight: 500;
}

.ti-control:hover:not(:disabled) {
  border-color: var(--mt-muted);
}

.ti-control:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
  border-color: var(--mt-accent);
}

.ti-control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ti-invalid .ti-control {
  border-color: var(--mt-err);
}

.ti-search .ti-control {
  padding-left: 34px;
  padding-right: 30px;
}

.ti-icon {
  position: absolute;
  left: 11px;
  color: var(--mt-muted);
  pointer-events: none;
}

.ti-clear {
  position: absolute;
  right: 6px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--mt-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.ti-clear:hover {
  color: var(--mt-ink);
  background: var(--mt-soft);
}

.ti-clear:focus-visible {
  outline: 2px solid var(--mt-accent);
}
</style>
