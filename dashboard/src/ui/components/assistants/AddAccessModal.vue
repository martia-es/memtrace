<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { AssistantPersonDto, GrantSubjectTypeDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";
import PersonPicker from "./PersonPicker.vue";
import Button from "../Button.vue";

/** Añade quién puede llamar a un despliegue. MemTrace lo documenta y lo sincroniza; no lo hace cumplir (ADR-053). */
const props = defineProps<{ experimentId: string; deploymentId: string; envLabel: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const form = reactive({ subjectType: "group" as GrantSubjectTypeDto, group: "", person: null as AssistantPersonDto | null, members: "" });
const saving = ref(false);

const canSave = computed(() => (form.subjectType === "group" ? form.group.trim() !== "" : form.subjectType === "user" ? form.person !== null : true));

async function save() {
  saving.value = true;
  try {
    await api.addGrant(props.experimentId, props.deploymentId, {
      subjectType: form.subjectType,
      userId: form.subjectType === "user" ? form.person?.userId ?? null : null,
      externalGroup: form.subjectType === "group" ? form.group.trim() : null,
      memberCount: form.subjectType === "group" && form.members.trim() !== "" ? Number(form.members) : null,
    });
    emit("saved");
    emit("close");
  } catch (error) {
    $q.notify({ message: `Could not add access: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
  } finally {
    saving.value = false;
  }
}
const SUBJECT_OPTIONS: { label: string; value: GrantSubjectTypeDto }[] = [
  { label: "A group from your identity provider (Okta, Entra ID…)", value: "group" },
  { label: "One person", value: "user" },
  { label: "Everyone in the organization", value: "everyone" },
];
</script>

<template>
  <Modal :title="`Who can call ${envLabel}`" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <label class="field">
        <span>Add</span>
        <Select v-model="form.subjectType" :options="SUBJECT_OPTIONS" data-testid="grant-type" />
      </label>
      <template v-if="form.subjectType === 'group'">
        <label class="field"><span>Group</span><TextInput v-model="form.group" placeholder="Support-Agents" autofocus /></label>
        <label class="field"><span>People in the group (optional)</span><TextInput v-model="form.members" type="number" min="0" /></label>
        <p class="hint">Use the same group name or id you mapped in Settings → Identity.</p>
      </template>
      <div v-else-if="form.subjectType === 'user'" class="field"><span>Person</span><PersonPicker v-model="form.person" :experiment-id="experimentId" /></div>
      <p v-else class="hint">Anyone signed in to the organization will be listed as allowed.</p>
      <div class="actions"><Button variant="primary" type="submit" :disabled="saving || !canSave">Add access</Button></div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
