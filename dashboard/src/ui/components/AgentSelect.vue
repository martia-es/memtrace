<script setup lang="ts">
import { computed, ref } from "vue";

interface Props {
  modelValue: string | null;
  options: string[];
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), { loading: false });
const emit = defineEmits<{ "update:modelValue": [value: string | null] }>();

const isOpen = ref(false);

const selectedLabel = computed(() => props.modelValue || "Seleccionar agente");

const handleSelect = (value: string) => {
  emit("update:modelValue", value === props.modelValue ? null : value);
  isOpen.value = false;
};

const handleClear = () => {
  emit("update:modelValue", null);
  isOpen.value = false;
};
</script>

<template>
  <div class="agent-select">
    <button
      class="select-trigger"
      :class="{ open: isOpen, active: modelValue }"
      @click="isOpen = !isOpen"
      :disabled="loading"
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
            v-if="modelValue"
            class="select-option clear"
            @click="handleClear"
          >
            Limpiar
          </button>
          <button
            v-for="option in options"
            :key="option"
            class="select-option"
            :class="{ selected: modelValue === option }"
            @click="handleSelect(option)"
          >
            {{ option }}
            <svg
              v-if="modelValue === option"
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
.agent-select {
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

.select-option.clear {
  color: var(--mt-muted);
  border-bottom: 1px solid var(--mt-border);
  font-size: 12px;
  font-weight: 500;
}

.select-option.clear:hover {
  background: var(--mt-soft);
  color: var(--mt-text);
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
