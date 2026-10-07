<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

defineOptions({ inheritAttrs: false });

interface Option {
  label: string;
  value: T;
}

interface Props {
  modelValue: T | null;
  options: Option[];
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  disabled: false,
  placeholder: "Select",
});

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const isOpen = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
/** El menú es `fixed` para que ningún contenedor con scroll (p. ej. un modal) lo recorte. */
const menuStyle = ref<Record<string, string>>({});

const selectedOption = computed(() => props.options.find((o) => o.value === props.modelValue));
const hasValue = computed(() => selectedOption.value !== undefined);
const selectedLabel = computed(() => selectedOption.value?.label || props.placeholder);

function place() {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const below = window.innerHeight - rect.bottom - 12;
  const up = below < 200 && rect.top > below;
  menuStyle.value = {
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    maxHeight: `${Math.max(120, Math.min(280, up ? rect.top - 12 : below))}px`,
    ...(up ? { bottom: `${window.innerHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` }),
  };
}

const optionEls = () => [...(menu.value?.querySelectorAll<HTMLElement>(".select-option") ?? [])];

async function open(focus: "selected" | "first" | "last" | null = null) {
  if (props.disabled || props.loading) return;
  place();
  isOpen.value = true;
  if (!focus) return;
  await nextTick();
  const items = optionEls();
  (focus === "last" ? items.at(-1) : focus === "first" ? items[0] : (items.find((o) => o.classList.contains("selected")) ?? items[0]))?.focus();
}

const closeMenu = (refocus = false) => {
  isOpen.value = false;
  if (refocus) trigger.value?.focus();
};

const handleSelect = (value: T) => {
  emit("update:modelValue", value);
  closeMenu(true);
};

function onTriggerKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    void open(event.key === "ArrowUp" ? "last" : "selected");
  }
}

function onMenuKey(event: KeyboardEvent) {
  const items = optionEls();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => {
    event.preventDefault();
    items[(i + items.length) % items.length]?.focus();
  };
  if (event.key === "ArrowDown") go(at + 1);
  else if (event.key === "ArrowUp") go(at - 1);
  else if (event.key === "Home") go(0);
  else if (event.key === "End") go(items.length - 1);
  else if (event.key === "Tab") closeMenu();
}

const onOutsideClick = (event: MouseEvent) => {
  const target = event.target as Node;
  if (isOpen.value && !root.value?.contains(target) && !menu.value?.contains(target)) closeMenu();
};
const onScroll = (event: Event) => {
  if (isOpen.value && !menu.value?.contains(event.target as Node)) closeMenu();
};
onMounted(() => {
  document.addEventListener("click", onOutsideClick);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", () => closeMenu());
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onOutsideClick);
  window.removeEventListener("scroll", onScroll, true);
});
</script>

<template>
  <div ref="root" class="select" @keydown.escape.stop="closeMenu(true)">
    <button
      v-bind="$attrs"
      ref="trigger"
      type="button"
      class="select-trigger"
      :class="{ open: isOpen, active: hasValue, empty: !hasValue }"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :disabled="loading || disabled"
      @click="isOpen ? closeMenu() : open()"
      @keydown="onTriggerKey"
    >
      <span class="select-label">{{ selectedLabel }}</span>
      <span class="select-chevron" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </span>
    </button>

    <transition name="dropdown">
      <div v-if="isOpen" ref="menu" class="select-menu" role="listbox" :style="menuStyle" @keydown="onMenuKey">
        <div v-if="loading" class="select-loading">
          <div class="spinner"></div>
          Loading...
        </div>
        <template v-else>
          <button
            v-for="option in options"
            :key="option.value"
            type="button"
            role="option"
            class="select-option"
            :class="{ selected: modelValue === option.value }"
            :aria-selected="modelValue === option.value"
            @click="handleSelect(option.value)"
          >
            <span class="option-text">{{ option.label }}</span>
            <svg
              v-if="modelValue === option.value"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </button>
        </template>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.select {
  position: relative;
  width: 100%;
  font-size: 13px;
}

/* Mismo lenguaje que TextInput: borde fino, fondo de tarjeta y un chevron discreto. */
.select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 36px;
  padding: 0 10px 0 12px;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.select-trigger:hover:not(:disabled) {
  border-color: var(--mt-muted);
}

.select-trigger:focus-visible,
.select-trigger.open {
  outline: none;
  border-color: var(--mt-accent);
}

.select-trigger.empty .select-label {
  color: var(--mt-muted);
}

.select-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.select-label {
  flex: 1;
  min-width: 0;
  text-align: left;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.select-chevron {
  flex-shrink: 0;
  display: flex;
  color: var(--mt-muted);
}

.select-chevron svg {
  transition: transform 0.15s ease;
}

.select-trigger.open .select-chevron svg {
  transform: rotate(180deg);
}

.select-menu {
  position: fixed;
  background: var(--mt-card);
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  box-shadow: 0 6px 18px rgba(10, 35, 33, 0.1);
  z-index: 1100;
  overflow-y: auto;
  padding: 4px;
}

.select-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 60px;
  color: var(--mt-muted);
  font-size: 12px;
}

.spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--mt-line);
  border-top-color: var(--mt-accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.select-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 34px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.option-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.select-option:hover,
.select-option:focus-visible {
  outline: none;
  background: var(--mt-soft);
}

.select-option.selected {
  background: var(--mt-soft);
  color: var(--mt-accent);
  font-weight: 600;
}

.dropdown-enter-active {
  animation: slideDown 0.15s ease;
}

.dropdown-leave-active {
  animation: slideDown 0.15s ease reverse;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
