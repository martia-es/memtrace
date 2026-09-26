<script setup lang="ts">
import { computed } from "vue";
import JsonBlock from "./JsonBlock.vue";

const props = defineProps<{ messages: unknown }>();

interface Message {
  role: string;
  content: unknown;
}

const parsed = computed<Message[] | null>(() => {
  const value = props.messages;
  if (!Array.isArray(value) || value.length === 0) return null;
  const ok = value.every((m) => typeof m === "object" && m !== null && "role" in m && "content" in m);
  return ok ? (value as Message[]) : null;
});

const roleColor = (role: string) => (role === "human" || role === "user" ? "primary" : role === "system" ? "grey-7" : "teal");
</script>

<template>
  <div v-if="parsed" class="column q-gutter-y-sm">
    <div v-for="(m, i) in parsed" :key="i">
      <q-badge :color="roleColor(m.role)" :label="m.role" class="q-mb-xs" />
      <div v-if="typeof m.content === 'string'" class="message">{{ m.content }}</div>
      <JsonBlock v-else :value="m.content" />
    </div>
  </div>
  <JsonBlock v-else :value="messages" />
</template>

<style scoped>
.message {
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--wf-line);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}
</style>
