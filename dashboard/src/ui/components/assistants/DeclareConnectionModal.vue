<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ConnectionKindDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";
import Button from "../Button.vue";
import FormField from "../FormField.vue";
import { t } from "../../i18n";

/** Declara una conexión que el asistente debe usar: servidor MCP, tool o agente (ADR-053). */
const props = defineProps<{ experimentId: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const form = reactive({ kind: "mcp_server" as ConnectionKindDto, name: "", via: "" });
const saving = ref(false);
const canSave = computed(() => form.name.trim() !== "");

async function save() {
  saving.value = true;
  try {
    await api.declareConnection(props.experimentId, { kind: form.kind, name: form.name.trim(), via: form.kind === "tool" && form.via.trim() ? form.via.trim() : null });
    emit("saved");
    emit("close");
  } catch (error) {
    $q.notify({ message: t("declareConnectionModal.could_not_declare_the_connection_error", { error: describeApiError(error as Error) }), color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
const KIND_OPTIONS: { label: string; value: ConnectionKindDto }[] = [
  { label: "MCP server", value: "mcp_server" },
  { get label() { return t("declareConnectionModal.tool"); }, value: "tool" },
  { get label() { return t("declareConnectionModal.agent"); }, value: "agent" },
];
</script>

<template>
  <Modal :title="t('declareConnectionModal.declare_a_connection')" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <FormField :label="t('declareConnectionModal.type')">
        <Select v-model="form.kind" :options="KIND_OPTIONS" data-testid="connection-kind" />
      </FormField>
      <FormField :label="t('declareConnectionModal.name')"><TextInput v-model="form.name" placeholder="weather-mcp" autofocus /></FormField>
      <FormField :label="t('declareConnectionModal.exposed_by_mcp_server_optional')" v-if="form.kind === 'tool'"><TextInput v-model="form.via" placeholder="weather-mcp" /></FormField>
      <p class="hint">{{ t("declareConnectionModal.declared_connections_are_approved_by_gov") }}</p>
      <div class="actions"><Button variant="primary" type="submit" :disabled="saving || !canSave">{{ t("declareConnectionModal.declare") }}</Button></div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
