<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ScoreConfigDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { parseCategories } from "../score-config-form";
import Modal from "./Modal.vue";
import Select from "./Select.vue";

/** Formulario de nueva score config (ADR-036), compartido por Admin → Score configs y el panel de anotación (ADR-037). */
const props = defineProps<{ experimentId: string }>();
const emit = defineEmits<{ close: []; created: [config: ScoreConfigDto] }>();

const api = useIdentityApi();
const $q = useQuasar();

const TYPE_OPTIONS = [
  { label: "Numeric (range)", value: "numeric" as const },
  { label: "Boolean (yes / no)", value: "boolean" as const },
  { label: "Categorical (labels)", value: "categorical" as const },
];

const saving = ref(false);
const form = reactive({ name: "", dataType: "numeric" as ScoreConfigDto["dataType"], min: "1", max: "5", categories: "", description: "" });

const canCreate = computed(() => {
  if (!form.name.trim()) return false;
  if (form.dataType === "numeric") return form.min.trim() !== "" && form.max.trim() !== "" && Number(form.min) < Number(form.max);
  if (form.dataType === "categorical") return parseCategories(form.categories).length >= 2;
  return true;
});

async function create() {
  saving.value = true;
  try {
    const config = await api.createScoreConfig(props.experimentId, {
      name: form.name.trim(),
      dataType: form.dataType,
      minValue: form.dataType === "numeric" ? Number(form.min) : null,
      maxValue: form.dataType === "numeric" ? Number(form.max) : null,
      categories: form.dataType === "categorical" ? parseCategories(form.categories) : null,
      description: form.description.trim() || null,
    });
    emit("created", config);
    emit("close");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    $q.notify({ message: `Could not create score config: ${detail}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Modal title="New score config" @close="emit('close')">
    <form class="modal-form" @submit.prevent="create">
      <input v-model="form.name" class="text-input" placeholder="Name (e.g. tone)" autofocus />
      <Select v-model="form.dataType" :options="TYPE_OPTIONS" />
      <div v-if="form.dataType === 'numeric'" class="range-row">
        <input v-model="form.min" class="text-input" type="number" step="any" placeholder="Min" />
        <input v-model="form.max" class="text-input" type="number" step="any" placeholder="Max" />
      </div>
      <template v-if="form.dataType === 'categorical'">
        <textarea v-model="form.categories" class="text-input area" rows="4" placeholder="One category per line (at least 2)&#10;bad=0&#10;ok=1&#10;good=2" />
        <p class="hint">Optional <code>=number</code> after a label gives it a value, used for correlation with judge scores.</p>
      </template>
      <textarea v-model="form.description" class="text-input area" rows="2" placeholder="Guideline shown to the annotator (optional)" />
      <button type="submit" class="primary-btn" :disabled="saving || !canCreate">Create</button>
    </form>
  </Modal>
</template>

<style scoped>
.hint {
  color: var(--mt-muted);
  font-size: 13px;
  margin: 0;
}
.hint code {
  font-family: var(--mt-mono);
  background: var(--mt-soft);
  padding: 1px 5px;
  border-radius: var(--mt-radius-sm);
  font-size: 12px;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.range-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  height: 40px;
  padding: 0 14px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
}
.text-input.area {
  height: auto;
  padding: 10px 14px;
  resize: vertical;
}
.text-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
}
.primary-btn {
  align-self: flex-start;
  height: 34px;
  padding: 0 16px;
  border-radius: var(--mt-radius-lg);
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
