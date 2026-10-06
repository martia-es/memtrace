<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { ref } from "vue";
import Select from "../Select.vue";

/**
 * Invitación inline por email (sin modal): el texto de ayuda dice exactamente qué rol recibe la persona.
 * El envío lo hace el padre; este componente solo recoge los datos y muestra el estado de envío.
 */
const props = defineProps<{
  title: string;
  help: string;
  roleOptions?: { label: string; value: string }[];
  sending?: boolean;
}>();
const emit = defineEmits<{ invite: [payload: { email: string; role: string }] }>();

const email = ref("");
const role = ref<string>(props.roleOptions?.[0]?.value ?? "technical");

function submit() {
  if (!email.value.trim()) return;
  emit("invite", { email: email.value.trim(), role: role.value });
  email.value = "";
}
</script>

<template>
  <form class="invite-form adm-card" @submit.prevent="submit">
    <h4 class="invite-title">{{ props.title }}</h4>
    <p class="adm-hint">{{ props.help }}</p>
    <div class="adm-form-row">
      <TextInput v-model="email" type="email" placeholder="Email of the person to invite" aria-label="Email" />
      <Select v-if="roleOptions" v-model="role" :options="roleOptions" />
      <button class="adm-btn primary" type="submit" :disabled="sending || !email.trim()">Send invitation</button>
    </div>
  </form>
</template>

<style scoped>
.invite-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.invite-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
</style>
