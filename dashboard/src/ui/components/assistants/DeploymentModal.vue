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
import Button from "../Button.vue";
import Checkbox from "../Checkbox.vue";
import FormField from "../FormField.vue";
import { t } from "../../i18n";

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
  deployRef: d?.deployRef ?? "",
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
    deployRef: text(form.deployRef),
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
  run(() => (d ? api.updateDeployment(props.experimentId, d.id, toInput()) : api.createDeployment(props.experimentId, form.environmentKey, toInput())), t("deploymentModal.could_not_save_the_deployment"));
const remove = () => run(() => api.deleteDeployment(props.experimentId, d!.id), t("deploymentModal.could_not_remove_the_deployment"));
const environmentOptions = computed(() => props.environments.map((e) => ({ label: e.label, value: e.key })));
const authOptions = Object.entries(AUTH_LABEL).map(([value, label]) => ({ label, value }));
</script>

<template>
  <Modal :title="editing ? t('deploymentModal.edit_env_deployment', { env: d!.environment.label }) : t('deploymentModal.add_a_deployment')" medium @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <FormField :label="t('deploymentModal.environment')" v-if="!editing">
        <Select v-model="form.environmentKey" :options="environmentOptions" data-testid="deployment-environment" />
      </FormField>
      <FormField :label="t('deploymentModal.api_url')">
        <TextInput v-model="form.apiUrl" :invalid="!!fieldErrors.apiUrl" placeholder="https://api.example.com/weather" autofocus />
        <span v-if="fieldErrors.apiUrl" class="field-error">{{ fieldErrors.apiUrl }}</span>
      </FormField>
      <FormField :label="t('deploymentModal.health_url_optional')">
        <TextInput v-model="form.healthUrl" :invalid="!!fieldErrors.healthUrl" :placeholder="t('deploymentModal.defaults_to_the_api_url_health')" />
        <span v-if="fieldErrors.healthUrl" class="field-error">{{ fieldErrors.healthUrl }}</span>
      </FormField>
      <div class="row">
        <FormField :label="t('deploymentModal.version')"><TextInput v-model="form.version" placeholder="v1.4.0" /></FormField>
        <FormField :label="t('deploymentModal.branch_or_tag_optional')">
          <TextInput v-model="form.deployRef" :invalid="!!fieldErrors.deployRef" placeholder="main" data-testid="deploy-ref" />
          <span v-if="fieldErrors.deployRef" class="field-error">{{ fieldErrors.deployRef }}</span>
        </FormField>
      </div>
      <FormField :label="t('deploymentModal.authentication')">
        <Select v-model="form.authMethod" :options="authOptions" />
      </FormField>
      <div v-if="form.authMethod !== 'none'" class="row">
        <FormField :label="t('deploymentModal.provider')"><TextInput v-model="form.authProvider" placeholder="Entra ID" /></FormField>
        <FormField :label="t('deploymentModal.audience')"><TextInput v-model="form.authAudience" placeholder="api://weather-assistant" /></FormField>
      </div>
      <p v-if="form.authMethod !== 'none'" class="hint">{{ t("deploymentModal.memtrace_never_stores_secrets_only_how") }}</p>
      <div class="row row-health">
        <Checkbox class="check" v-model="form.healthCheckEnabled">{{ t("deploymentModal.check_health_automatically") }}</Checkbox>
        <FormField :label="t('deploymentModal.check_every_seconds')">
          <TextInput v-model="form.interval" :invalid="!!fieldErrors.healthIntervalSeconds" type="number" min="15" :placeholder="t('deploymentModal.environment_default')" />
          <span v-if="fieldErrors.healthIntervalSeconds" class="field-error">{{ fieldErrors.healthIntervalSeconds }}</span>
        </FormField>
      </div>
      <div class="actions">
        <Button variant="primary" type="submit" :disabled="saving || !canSave">{{ editing ? t("deploymentModal.save") : t("deploymentModal.add_deployment") }}</Button>
        <div class="spacer" />
        <template v-if="editing">
          <Button variant="danger" v-if="!confirmingDelete" @click="confirmingDelete = true">{{ t("deploymentModal.remove") }}</Button>
          <Button variant="danger" v-else :disabled="saving" @click="remove">{{ t("deploymentModal.confirm_remove") }}</Button>
        </template>
      </div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
<style scoped>
.row-health { align-items: end; }
.row-health .check { height: 36px; }
</style>
