<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { AssistantCardDto, RepoConfigDto } from "@contract";

type RepoProvider = RepoConfigDto["provider"];
const PROVIDERS: { label: string; value: RepoProvider }[] = [
  { label: "GitHub", value: "github" },
  { label: "GitLab", value: "gitlab" },
  { label: "Bitbucket", value: "bitbucket" },
];
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";

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
      repo: repoUrl === "" ? null : { url: repoUrl, provider: form.repoProvider, deployWorkflow: form.deployWorkflow.trim() || null },
    });
    emit("saved");
    emit("close");
  } catch (error) {
    fieldErrors.value = (error as { fields?: Record<string, string> }).fields ?? {};
    $q.notify({ message: `Could not save: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
const LIFECYCLE_OPTIONS: { label: string; value: "active" | "retired" }[] = [
  { label: "Active", value: "active" },
  { label: "Retired (health checks stop)", value: "retired" },
];
</script>

<template>
  <Modal :title="`Edit ${card.name}`" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <label class="field"><span>Description</span><TextInput multiline v-model="form.description" :rows="3" /></label>
      <label class="field">
        <span>Lifecycle</span>
        <Select v-model="form.lifecycle" :options="LIFECYCLE_OPTIONS" />
      </label>
      <fieldset class="chat">
        <legend>Chat endpoint</legend>
        <label class="field">
          <span>Path</span>
          <TextInput v-model="form.chatPath" :invalid="!!fieldErrors.path" placeholder="/api/chat" data-testid="chat-path" />
          <span v-if="fieldErrors.path" class="field-error">{{ fieldErrors.path }}</span>
          <p class="hint">Same in every environment: the host comes from each deployment. Leave empty if the agent has no chat.</p>
        </label>
        <div v-if="form.chatPath.trim() !== ''" class="row">
          <label class="field"><span>Message field</span><TextInput v-model="form.requestField" :invalid="!!fieldErrors.requestField" /></label>
          <label class="field"><span>Reply field</span><TextInput v-model="form.responseField" :invalid="!!fieldErrors.responseField" placeholder="reply or data.answer" /></label>
        </div>
        <label v-if="form.chatPath.trim() !== ''" class="field">
          <span>Session field (optional)</span>
          <TextInput v-model="form.sessionField" placeholder="session_id" />
          <p class="hint">JSON key that carries the conversation id, in the request and in the reply.</p>
        </label>
        <label v-if="form.chatPath.trim() !== ''" class="field">
          <span>Trace id field (optional)</span>
          <TextInput v-model="form.traceIdField" :invalid="!!fieldErrors.traceIdField" placeholder="trace_id" data-testid="chat-trace-id-field" />
          <p class="hint">Key of the reply with the id of the trace that produced it. With it, each answer in MemTrace's chat gets 👍/👎 and the vote is saved on that trace.</p>
        </label>
      </fieldset>
      <fieldset class="chat">
        <legend>Source repository</legend>
        <div class="row">
          <label class="field"><span>Provider</span><Select v-model="form.repoProvider" :options="PROVIDERS" /></label>
          <label class="field">
            <span>Repository URL</span>
            <TextInput v-model="form.repoUrl" :invalid="!!fieldErrors.url" placeholder="https://github.com/acme/weather" data-testid="repo-url" />
            <span v-if="fieldErrors.url" class="field-error">{{ fieldErrors.url }}</span>
          </label>
        </div>
        <label v-if="form.repoUrl.trim() !== ''" class="field">
          <span>Deploy workflow (optional)</span>
          <TextInput v-model="form.deployWorkflow" :invalid="!!fieldErrors.deployWorkflow" placeholder="deploy.yml" data-testid="deploy-workflow" />
          <p class="hint">The pipeline MemTrace will trigger to deploy. Leave the URL empty if the agent has no repository. No credentials are stored here.</p>
        </label>
      </fieldset>
      <div class="actions"><button type="submit" class="primary-btn" :disabled="saving">Save</button></div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
<style scoped>
.chat { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 10px 12px 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.chat legend { padding: 0 6px; font-size: 12px; font-weight: 700; color: var(--mt-muted); }
</style>
