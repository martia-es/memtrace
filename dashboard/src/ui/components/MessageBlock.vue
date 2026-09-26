<script setup lang="ts">
import type { IoBlock } from "@/domain/span-io";

defineProps<{ block: IoBlock }>();

const roleName = (role: IoBlock["role"]) =>
  ({ user: "Humano", assistant: "IA", system: "Sistema", tool: "Herramienta", error: "Error", other: "Contenido" })[role];

const argValue = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
</script>

<template>
  <article class="msg" :class="`role-${block.role}`">
    <header class="head">
      <span class="role">{{ roleName(block.role) }}</span>
      <span v-if="block.label.toLowerCase() !== roleName(block.role).toLowerCase() && block.label !== block.role" class="tag mono">{{ block.label }}</span>
    </header>

    <div v-if="!block.hideText" class="section">
      <pre v-if="block.structured" class="text mono">{{ block.text }}</pre>
      <p v-else-if="block.text" class="text">{{ block.text }}</p>
      <p v-else class="text muted">Mensaje vacío</p>
    </div>

    <div v-for="(c, i) in block.calls" :key="i" class="call">
      <div class="call-head section">
        <span class="fn mono">{{ c.name }}</span>
        <span v-if="c.id" class="chip mono">{{ c.id }}</span>
      </div>
      <dl v-if="Object.keys(c.args).length" class="args mono">
        <div v-for="(v, k) in c.args" :key="k" class="arg">
          <dt>{{ k }}:</dt>
          <dd>{{ argValue(v) }}</dd>
        </div>
      </dl>
      <p v-else class="no-args muted">Sin argumentos</p>
    </div>
  </article>
</template>

<style scoped>
.msg {
  --accent: var(--mt-faint);
  flex-shrink: 0;
  border: 1px solid var(--mt-line);
  border-radius: 12px;
  background: var(--mt-card);
  overflow: hidden;
  margin-bottom: 10px;
}
.role-user {
  --accent: var(--mt-accent);
}
.role-assistant {
  --accent: #c4f26b;
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
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--mt-line-2);
  background: var(--mt-soft-2);
}
.role {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--accent);
}
.tag {
  font-size: 11px;
  color: var(--mt-faint);
}

.section {
  padding: 12px 16px;
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

.call + .call,
.section + .call {
  border-top: 1px solid var(--mt-line-2);
}
.call-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 10px;
}
.fn {
  font-size: 15px;
  font-weight: 600;
  color: var(--mt-ink);
}
.chip {
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--mt-line);
  background: var(--mt-soft-2);
  font-size: 11px;
  color: var(--mt-muted);
  overflow-wrap: anywhere;
}
.args {
  margin: 0;
  padding: 10px 16px 12px;
  background: color-mix(in srgb, var(--mt-accent) 5%, var(--mt-card));
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  line-height: 1.55;
}
.arg {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.arg dt {
  color: var(--mt-accent);
  flex-shrink: 0;
}
.arg dd {
  margin: 0;
  color: var(--mt-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.no-args {
  margin: 0;
  padding: 0 16px 12px;
  font-size: 12.5px;
}
</style>
