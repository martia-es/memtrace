<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ScoreConfigDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { parseCategories, parseTargetPercent } from "../score-config-form";
import Modal from "./Modal.vue";
import Select from "./Select.vue";
import Button from "./Button.vue";

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
const form = reactive({ name: "", dataType: "numeric" as ScoreConfigDto["dataType"], min: "1", max: "5", categories: "", target: "", description: "" });

const canCreate = computed(() => {
  if (!form.name.trim()) return false;
  if (form.dataType === "numeric") return form.min.trim() !== "" && form.max.trim() !== "" && Number(form.min) < Number(form.max);
  if (form.dataType === "categorical") return parseCategories(form.categories).length >= 2;
  if (form.dataType === "boolean") return !Number.isNaN(parseTargetPercent(form.target));
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
      targetPassRate: form.dataType === "boolean" ? parseTargetPercent(form.target) : null,
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
      <TextInput v-model="form.name" placeholder="Name (e.g. tone)" autofocus />
      <Select v-model="form.dataType" :options="TYPE_OPTIONS" />
      <div v-if="form.dataType === 'numeric'" class="range-row">
        <TextInput v-model="form.min" type="number" step="any" placeholder="Min" />
        <TextInput v-model="form.max" type="number" step="any" placeholder="Max" />
      </div>
      <template v-if="form.dataType === 'boolean'">
        <TextInput v-model="form.target" type="number" step="any" min="1" max="100" placeholder="Target pass rate in % (optional, default 80)" />
        <p class="hint">Evaluators with this name are judged against this target in Evaluations → Trends.</p>
      </template>
      <template v-if="form.dataType === 'categorical'">
        <TextInput multiline v-model="form.categories" :rows="4" placeholder="One category per line (at least 2)&#10;bad=0&#10;ok=1&#10;good=2" />
        <p class="hint">Optional <code>=number</code> after a label gives it a value, used for correlation with judge scores.</p>
      </template>
      <TextInput multiline v-model="form.description" :rows="2" placeholder="Guideline shown to the annotator (optional)" />
      <Button class="self-start" variant="primary" type="submit" :disabled="saving || !canCreate">Create</Button>
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

.self-start { align-self: flex-start; }
</style>
