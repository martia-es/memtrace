<script setup lang="ts">
import { ref } from "vue";
import type { IoBlock } from "@/domain/span-io";
import Button from "./Button.vue";

defineProps<{ block: IoBlock }>();

const roleName = (role: IoBlock["role"]) =>
  ({ user: "User", assistant: "AI", system: "System", tool: "Tool", error: "Error", other: "Content" })[role];

const roleIcon = (role: IoBlock["role"]) =>
  ({ user: "person", assistant: "smart_toy", system: "settings", tool: "build", error: "error", other: "notes" })[role];

const argValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

const copiedText = ref(false);
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copiedText.value = true;
    setTimeout(() => (copiedText.value = false), 1200);
  } catch {
    /* clipboard unavailable */
  }
}

const copiedCall = ref<number | null>(null);
async function copyCall(i: number, name: string, args: Record<string, unknown>) {
  try {
    await navigator.clipboard.writeText(JSON.stringify({ name, args }, null, 2));
    copiedCall.value = i;
    setTimeout(() => (copiedCall.value = null), 1200);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <article class="msg" :class="`role-${block.role}`">
    <header class="head">
      <span class="avatar">
        <q-icon :name="roleIcon(block.role)" size="13px" />
      </span>
      <span class="role">{{ roleName(block.role) }}</span>
      <span v-if="block.label.toLowerCase() !== roleName(block.role).toLowerCase() && block.label !== block.role" class="tag mono">{{ block.label }}</span>
      <Button variant="icon" size="sm" v-if="!block.hideText && block.text" class="copy-btn" aria-label="Copy" @click="copyText(block.text)">
        <q-icon :name="copiedText ? 'check' : 'content_copy'" size="12px" />
      </Button>
    </header>

    <div v-if="!block.hideText" class="body">
      <pre v-if="block.structured" class="text mono">{{ block.text }}</pre>
      <p v-else-if="block.text" class="text">{{ block.text }}</p>
      <p v-else class="text muted">Empty message</p>
    </div>

    <div v-for="(c, i) in block.calls" :key="i" class="call">
      <div class="call-head">
        <q-icon name="bolt" size="13px" class="call-icon" />
        <span class="fn mono">{{ c.name }}</span>
        <span v-if="c.id" class="chip mono">{{ c.id }}</span>
        <Button variant="icon" size="sm" class="copy-btn" aria-label="Copy call" @click="copyCall(i, c.name, c.args)">
          <q-icon :name="copiedCall === i ? 'check' : 'content_copy'" size="12px" />
        </Button>
      </div>
      <dl v-if="Object.keys(c.args).length" class="args mono">
        <div v-for="(v, k) in c.args" :key="k" class="arg">
          <dt>{{ k }}</dt>
          <dd>{{ argValue(v) }}</dd>
        </div>
      </dl>
    </div>
  </article>
</template>

<style scoped>
.msg {
  --accent: var(--mt-faint);
  flex-shrink: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--mt-line);
}
.msg:last-child {
  border-bottom: none;
}
.role-user {
  --accent: var(--mt-accent);
}
.role-assistant {
  --accent: #7ecf96;
}
.role-tool {
  --accent: var(--mt-warn-ink);
}
.role-error {
  --accent: var(--mt-err-ink);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: var(--mt-radius-xs);
  background: color-mix(in srgb, var(--accent) 16%, var(--mt-card));
  color: var(--accent);
}
.role {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mt-ink);
}
.tag {
  font-size: 11px;
  color: var(--mt-faint);
}
.copy-btn { margin-left: auto; }
.msg:hover .copy-btn,
.call:hover .copy-btn {
  opacity: 1;
}


.body {
  padding-left: 28px;
}
.text {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--mt-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.text.mono {
  font-size: 12px;
  line-height: 1.55;
}
.role-system .text {
  color: var(--mt-muted);
}
.role-error .text {
  color: var(--mt-err-ink);
}
.muted {
  color: var(--mt-faint);
}

.call {
  margin-top: 8px;
  padding-left: 28px;
}
.call-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.call-icon {
  color: var(--mt-accent);
}
.fn {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mt-ink);
}
.chip {
  padding: 1px 7px;
  border-radius: var(--mt-radius-xs);
  border: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
  font-size: 10.5px;
  color: var(--mt-muted);
  overflow-wrap: anywhere;
}
.args {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft-2);
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  line-height: 1.5;
}
.arg {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.arg dt {
  color: var(--mt-muted);
  flex-shrink: 0;
}
.arg dt::after {
  content: ":";
}
.arg dd {
  margin: 0;
  color: var(--mt-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
