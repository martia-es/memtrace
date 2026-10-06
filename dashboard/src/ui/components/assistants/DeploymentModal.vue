<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { AuthMethodDto, DeploymentSummaryDto, EnvironmentDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { ApiError } from "@/application/trace-api";
import type { DeploymentInput } from "@/application/assistant-api";
import { AUTH_LABEL } from "@/domain/assistants";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";

/** Alta o edición de un despliegue (ADR-053). Nunca se piden secretos: solo cómo se autentica. */
const props = defineProps<{ experimentId: string; deployment?: DeploymentSummaryDto; environments: EnvironmentDto[] }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const editing = computed(() => props.deployment !== undefined);
const d = props.deployment;

const form = reactive({
  environmentKey: props.environments[0]?.key ?? "",
  apiUrl: d?.apiUrl ?? "",
  healthUrl: d?.healthUrl ?? "",
  version: d?.version ?? "",
  authMethod: (d?.authMethod ?? "none") as AuthMethodDto,
  authProvider: d?.authProvider ?? "",
  authAudience: d?.authAudience ?? "",
  healthCheckEnabled: d?.healthCheckEnabled ?? true,
  interval: d?.healthIntervalSeconds != null ? String(d.healthIntervalSeconds) : "",
});
const saving = ref(false);
const confirmingDelete = ref(false);
const fieldErrors = ref<Record<string, string>>({});

const canSave = computed(() => form.apiUrl.trim() !== "" && (editing.value || form.environmentKey !== ""));

function toInput(): DeploymentInput {
  const text = (v: string) => v.trim() || null;
  return {
    apiUrl: form.apiUrl.trim(),
    healthUrl: text(form.healthUrl),
    version: text(form.version),
    authMethod: form.authMethod,
    authProvider: text(form.authProvider),
    authAudience: text(form.authAudience),
    healthCheckEnabled: form.healthCheckEnabled,
    healthIntervalSeconds: form.interval.trim() === "" ? null : Number(form.interval),
  };
}

async function run(action: () => Promise<unknown>, failure: string) {
  saving.value = true;
  fieldErrors.value = {};
  try {
    await action();
    emit("saved");
    emit("close");
  } catch (error) {
    if (error instanceof ApiError && error.fields) fieldErrors.value = error.fields;
    $q.notify({ message: `${failure}: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}

const save = () =>
  run(() => (d ? api.updateDeployment(props.experimentId, d.id, toInput()) : api.createDeployment(props.experimentId, form.environmentKey, toInput())), "Could not save the deployment");
const remove = () => run(() => api.deleteDeployment(props.experimentId, d!.id), "Could not remove the deployment");
const environmentOptions = computed(() => props.environments.map((e) => ({ label: e.label, value: e.key })));
const authOptions = Object.entries(AUTH_LABEL).map(([value, label]) => ({ label, value }));
</script>

<template>
  <Modal :title="editing ? `Edit ${d!.environment.label} deployment` : 'Add a deployment'" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <label v-if="!editing" class="field">
        <span>Environment</span>
        <Select v-model="form.environmentKey" :options="environmentOptions" data-testid="deployment-environment" />
      </label>
      <label class="field">
        <span>API URL</span>
        <TextInput v-model="form.apiUrl" :invalid="!!fieldErrors.apiUrl" placeholder="https://api.example.com/weather" autofocus />
        <span v-if="fieldErrors.apiUrl" class="field-error">{{ fieldErrors.apiUrl }}</span>
      </label>
      <label class="field">
        <span>Health URL (optional)</span>
        <TextInput v-model="form.healthUrl" :invalid="!!fieldErrors.healthUrl" placeholder="Defaults to the API URL + /health" />
        <span v-if="fieldErrors.healthUrl" class="field-error">{{ fieldErrors.healthUrl }}</span>
      </label>
      <div class="row">
        <label class="field"><span>Version</span><TextInput v-model="form.version" placeholder="v1.4.0" /></label>
        <label class="field">
          <span>Authentication</span>
          <Select v-model="form.authMethod" :options="authOptions" />
        </label>
      </div>
      <div v-if="form.authMethod !== 'none'" class="row">
        <label class="field"><span>Provider</span><TextInput v-model="form.authProvider" placeholder="Entra ID" /></label>
        <label class="field"><span>Audience</span><TextInput v-model="form.authAudience" placeholder="api://weather-assistant" /></label>
      </div>
      <p v-if="form.authMethod !== 'none'" class="hint">MemTrace never stores secrets: only how this deployment authenticates.</p>
      <div class="row">
        <label class="check"><input v-model="form.healthCheckEnabled" type="checkbox" />Check /health automatically</label>
        <label class="field">
          <span>Check every (seconds)</span>
          <TextInput v-model="form.interval" :invalid="!!fieldErrors.healthIntervalSeconds" type="number" min="15" placeholder="Environment default" />
          <span v-if="fieldErrors.healthIntervalSeconds" class="field-error">{{ fieldErrors.healthIntervalSeconds }}</span>
        </label>
      </div>
      <div class="actions">
        <button type="submit" class="primary-btn" :disabled="saving || !canSave">{{ editing ? "Save" : "Add deployment" }}</button>
        <div class="spacer" />
        <template v-if="editing">
          <button v-if="!confirmingDelete" type="button" class="danger-btn" @click="confirmingDelete = true">Remove</button>
          <button v-else type="button" class="danger-btn" :disabled="saving" @click="remove">Confirm remove</button>
        </template>
      </div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
