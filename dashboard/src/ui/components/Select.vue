<script setup lang="ts" generic="T extends string | number">
import { computed, ref } from "vue";

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
  placeholder: "Seleccionar",
});

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const isOpen = ref(false);

const selectedLabel = computed(() => {
  const option = props.options.find((o) => o.value === props.modelValue);
  return option?.label || props.placeholder;
});

const handleSelect = (value: T) => {
  emit("update:modelValue", value);
  isOpen.value = false;
};

const closeMenu = () => {
  isOpen.value = false;
};
</script>

<template>
  <div class="select" @keydown.escape="closeMenu">
    <button
      class="select-trigger"
      :class="{ open: isOpen, active: modelValue !== null }"
      :disabled="loading || disabled"
      @click="isOpen = !isOpen"
    >
      <span class="select-label">{{ selectedLabel }}</span>
      <svg
        class="select-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>

    <transition name="dropdown">
      <div v-if="isOpen" class="select-menu">
        <div v-if="loading" class="select-loading">
          <div class="spinner"></div>
          Cargando...
        </div>
        <template v-else>
          <button
            v-for="option in options"
            :key="option.value"
            class="select-option"
            :class="{ selected: modelValue === option.value }"
            @click="handleSelect(option.value)"
          >
            {{ option.label }}
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

.select-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  background: var(--mt-card);
  border: 1px solid var(--mt-border);
  border-radius: 8px;
  color: var(--mt-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.select-trigger:hover:not(:disabled) {
  border-color: var(--mt-accent);
  background: var(--mt-soft);
}

.select-trigger.active {
  border-color: var(--mt-accent);
  color: var(--mt-accent);
}

.select-trigger.open {
  border-color: var(--mt-accent);
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  background: var(--mt-card);
}

.select-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.select-label {
  flex: 1;
  text-align: left;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.select-icon {
  flex-shrink: 0;
  color: var(--mt-muted);
  transition: transform 0.2s ease;
}

.select-trigger.open .select-icon {
  transform: rotate(180deg);
}

.select-menu {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--mt-card);
  border: 1px solid var(--mt-border);
  border-top: none;
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  z-index: 100;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 0;
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
  border: 1.5px solid var(--mt-border);
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
  height: 36px;
  padding: 0 12px;
  background: transparent;
  border: none;
  color: var(--mt-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
  text-align: left;
}

.select-option:hover {
  background: var(--mt-soft);
}

.select-option.selected {
  background: rgba(127, 207, 74, 0.08);
  color: var(--mt-accent);
  font-weight: 600;
}

.dropdown-enter-active {
  animation: slideDown 0.2s ease;
}

.dropdown-leave-active {
  animation: slideDown 0.2s ease reverse;
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
