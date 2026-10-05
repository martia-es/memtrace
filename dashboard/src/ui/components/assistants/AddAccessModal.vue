<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { GrantSubjectTypeDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAssistantApi } from "../../composables/useAssistantApi";
import Modal from "../Modal.vue";

/** Añade quién puede llamar a un despliegue. MemTrace lo documenta y lo sincroniza; no lo hace cumplir (ADR-053). */
const props = defineProps<{ experimentId: string; deploymentId: string; envLabel: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const form = reactive({ subjectType: "group" as GrantSubjectTypeDto, group: "", userId: "", members: "" });
const saving = ref(false);

const canSave = computed(() => (form.subjectType === "group" ? form.group.trim() !== "" : form.subjectType === "user" ? form.userId.trim() !== "" : true));

async function save() {
  saving.value = true;
  try {
    await api.addGrant(props.experimentId, props.deploymentId, {
      subjectType: form.subjectType,
      userId: form.subjectType === "user" ? form.userId.trim() : null,
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
</script>

<template>
  <Modal :title="`Who can call ${envLabel}`" @close="emit('close')">
    <form class="modal-form" @submit.prevent="save">
      <label class="field">
        <span>Add</span>
        <select v-model="form.subjectType" class="text-input" data-testid="grant-type">
          <option value="group">A group from the identity provider</option>
          <option value="user">One user</option>
          <option value="everyone">Everyone in the organization</option>
        </select>
      </label>
      <template v-if="form.subjectType === 'group'">
        <label class="field"><span>Group</span><input v-model="form.group" class="text-input" placeholder="Support-Agents" autofocus /></label>
        <label class="field"><span>People in the group (optional)</span><input v-model="form.members" class="text-input" type="number" min="0" /></label>
        <p class="hint">Use the same group name or id you mapped in Settings → Identity.</p>
      </template>
      <label v-else-if="form.subjectType === 'user'" class="field"><span>User id</span><input v-model="form.userId" class="text-input" placeholder="User id (uuid)" autofocus /></label>
      <p v-else class="hint">Anyone signed in to the organization will be listed as allowed.</p>
      <div class="actions"><button type="submit" class="primary-btn" :disabled="saving || !canSave">Add access</button></div>
    </form>
  </Modal>
</template>

<style scoped src="./form.css"></style>
