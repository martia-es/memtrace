<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { AssistantCardDto, RepoConfigDto } from "@contract";
import { t } from "../../i18n";

type RepoProvider = RepoConfigDto["provider"];
const PROVIDERS: { label: string; value: RepoProvider }[] = [
  { label: "GitHub", value: "github" },
  { label: "GitLab", value: "gitlab" },
  { label: "Bitbucket", value: "bitbucket" },
];
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";
import Button from "../Button.vue";
import Checkbox from "../Checkbox.vue";
import FormField from "../FormField.vue";

const props = defineProps<{ card: AssistantCardDto }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const chat = props.card.chat;
const repo = props.card.repo;
const form = reactive({
  description: props.card.description,
  lifecycle: props.card.lifecycle,
  chatPath: chat?.path ?? "",
  requestField: chat?.requestField ?? "message",
  responseField: chat?.responseField ?? "reply",
  sessionField: chat?.sessionField ?? "",
  traceIdField: chat?.traceIdField ?? "",
  repoUrl: repo?.url ?? "",
  repoProvider: (repo?.provider ?? "github") as RepoProvider,
  deployWorkflow: repo?.deployWorkflow ?? "",
  prGate: repo?.prGate ?? false,
});
const fieldErrors = ref<Record<string, string>>({});
const saving = ref(false);

async function save() {
  saving.value = true;
  try {
    const path = form.chatPath.trim();
    const repoUrl = form.repoUrl.trim();
    await api.updateAssistant(props.card.experimentId, {
      description: form.description.trim(),
      lifecycle: form.lifecycle,
      chat: path === "" ? null : { path, requestField: form.requestField.trim(), responseField: form.responseField.trim(), sessionField: form.sessionField.trim() || null, traceIdField: form.traceIdField.trim() || null },
      repo: repoUrl === "" ? null : { url: repoUrl, provider: form.repoProvider, deployWorkflow: form.deployWorkflow.trim() || null, prGate: form.prGate && form.repoProvider === "github" },
    });
    emit("saved");
    emit("close");
  } catch (error) {
    fieldErrors.value = (error as { fields?: Record<string, string> }).fields ?? {};
    $q.notify({ message: t("editAssistantModal.could_not_save_error", { error: describeApiError(error as Error) }), color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
const LIFECYCLE_OPTIONS: { label: string; value: "active" | "retired" }[] = [
  { label: t("editAssistantModal.active"), value: "active" },
  { label: t("editAssistantModal.retired_health_checks_stop"), value: "retired" },
];
</script>

<template>
  <Modal :title="t('editAssistantModal.edit_name', { name: card.name })" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <FormField :label="t('editAssistantModal.description')"><TextInput multiline v-model="form.description" :rows="3" /></FormField>
      <FormField :label="t('editAssistantModal.lifecycle')">
        <Select v-model="form.lifecycle" :options="LIFECYCLE_OPTIONS" />
      </FormField>
      <fieldset class="chat">
        <legend>{{ t("editAssistantModal.chat_endpoint") }}</legend>
        <FormField :label="t('editAssistantModal.path')">
          <TextInput v-model="form.chatPath" :invalid="!!fieldErrors.path" placeholder="/api/chat" data-testid="chat-path" />
          <span v-if="fieldErrors.path" class="field-error">{{ fieldErrors.path }}</span>
          <p class="hint">{{ t("editAssistantModal.same_in_every_environment_the_host") }}</p>
        </FormField>
        <div v-if="form.chatPath.trim() !== ''" class="row">
          <FormField :label="t('editAssistantModal.message_field')"><TextInput v-model="form.requestField" :invalid="!!fieldErrors.requestField" /></FormField>
          <FormField :label="t('editAssistantModal.reply_field')"><TextInput v-model="form.responseField" :invalid="!!fieldErrors.responseField" :placeholder="t('editAssistantModal.reply_or_data_answer')" /></FormField>
        </div>
        <FormField :label="t('editAssistantModal.session_field_optional')" v-if="form.chatPath.trim() !== ''">
          <TextInput v-model="form.sessionField" placeholder="session_id" />
          <p class="hint">{{ t("editAssistantModal.json_key_that_carries_the_conversation") }}</p>
        </FormField>
        <FormField :label="t('editAssistantModal.trace_id_field_optional')" v-if="form.chatPath.trim() !== ''">
          <TextInput v-model="form.traceIdField" :invalid="!!fieldErrors.traceIdField" placeholder="trace_id" data-testid="chat-trace-id-field" />
          <p class="hint">{{ t("editAssistantModal.key_of_the_reply_with_the") }}</p>
        </FormField>
      </fieldset>
      <fieldset class="chat">
        <legend>{{ t("editAssistantModal.source_repository") }}</legend>
        <div class="row">
          <FormField :label="t('editAssistantModal.provider')"><Select v-model="form.repoProvider" :options="PROVIDERS" /></FormField>
          <FormField :label="t('editAssistantModal.repository_url')">
            <TextInput v-model="form.repoUrl" :invalid="!!fieldErrors.url" placeholder="https://github.com/acme/weather" data-testid="repo-url" />
            <span v-if="fieldErrors.url" class="field-error">{{ fieldErrors.url }}</span>
          </FormField>
        </div>
        <FormField :label="t('editAssistantModal.deploy_workflow_optional')" v-if="form.repoUrl.trim() !== ''">
          <TextInput v-model="form.deployWorkflow" :invalid="!!fieldErrors.deployWorkflow" placeholder="deploy.yml" data-testid="deploy-workflow" />
          <p class="hint">{{ t("editAssistantModal.the_pipeline_memtrace_will_trigger_to") }}</p>
        </FormField>
        <FormField :label="t('editAssistantModal.pull_requests')" v-if="form.repoUrl.trim() !== '' && form.repoProvider === 'github'">
          <Checkbox v-model="form.prGate" variant="switch" data-testid="pr-gate">{{ t("editAssistantModal.check_the_evaluation_of_every_commit") }}</Checkbox>
          <p class="hint">
            {{ t("editAssistantModal.memtrace_publishes_a") + " " }}<code>memtrace/eval-gate</code>{{ " " + t("editAssistantModal.check_on_the_commit_that_was") }}
          </p>
        </FormField>
      </fieldset>
      <div class="actions"><Button variant="primary" type="submit" :disabled="saving">{{ t("editAssistantModal.save") }}</Button></div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
<style scoped>
.chat { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 10px 12px 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.chat legend { padding: 0 6px; font-size: 12px; font-weight: 700; color: var(--mt-muted); }
</style>
