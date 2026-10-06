<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { AssistantCardDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";

const props = defineProps<{ card: AssistantCardDto }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const chat = props.card.chat;
const form = reactive({
  description: props.card.description,
  lifecycle: props.card.lifecycle,
  chatPath: chat?.path ?? "",
  requestField: chat?.requestField ?? "message",
  responseField: chat?.responseField ?? "reply",
  sessionField: chat?.sessionField ?? "",
});
const fieldErrors = ref<Record<string, string>>({});
const saving = ref(false);

async function save() {
  saving.value = true;
  try {
    const path = form.chatPath.trim();
    await api.updateAssistant(props.card.experimentId, {
      description: form.description.trim(),
      lifecycle: form.lifecycle,
      chat: path === "" ? null : { path, requestField: form.requestField.trim(), responseField: form.responseField.trim(), sessionField: form.sessionField.trim() || null },
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
