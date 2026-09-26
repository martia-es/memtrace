<script setup lang="ts">
import type { IoBlock } from "@/domain/span-io";

defineProps<{ block: IoBlock }>();

const icon = (role: IoBlock["role"]) =>
  ({ user: "person", assistant: "smart_toy", system: "settings", tool: "build", error: "error", other: "info" })[role];

const tint = (role: IoBlock["role"]) =>
  ({
    user: "var(--msg-user-bg)",
    assistant: "var(--msg-assistant-bg)",
    system: "var(--msg-system-bg)",
    tool: "var(--msg-tool-bg)",
    error: "var(--msg-error-bg)",
    other: "var(--msg-other-bg)",
  })[role];

const labelColor = (role: IoBlock["role"]) =>
  ({
    user: "var(--msg-user-label)",
    assistant: "var(--msg-assistant-label)",
    system: "var(--msg-system-label)",
    tool: "var(--msg-tool-label)",
    error: "var(--msg-error-label)",
    other: "var(--msg-other-label)",
  })[role];
</script>

<template>
  <div class="message-block" :class="`role-${block.role}`" :style="{ '--bg': tint(block.role), '--label-color': labelColor(block.role) } as any">
    <div class="header">
      <q-icon :name="icon(block.role)" size="16px" />
      <span class="label">{{ block.label }}</span>
    </div>
    <pre v-if="block.structured" class="content mono">{{ block.text }}</pre>
    <div v-else class="content">{{ block.text }}</div>
  </div>
</template>

<style scoped>
:root {
  --msg-user-bg: #f0f5f3;
  --msg-user-label: #1f4a37;
  --msg-user-text: #1a1a1a;
  --msg-assistant-bg: #f0ebff;
  --msg-assistant-label: #2a1e7f;
  --msg-assistant-text: #1a1a1a;
  --msg-system-bg: #fef8f0;
  --msg-system-label: #4a3a00;
  --msg-system-text: #2d2d2d;
  --msg-tool-bg: #fff4ea;
  --msg-tool-label: #5a2a0a;
  --msg-tool-text: #2d2d2d;
  --msg-error-bg: #fff0ee;
  --msg-error-label: #7a0a0a;
  --msg-error-text: #4a0a0a;
  --msg-other-bg: #f0f5f3;
  --msg-other-label: #1f4a37;
  --msg-other-text: #1a1a1a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --msg-user-bg: #1a3a2e;
    --msg-user-label: #7eddcb;
    --msg-user-text: #d0f0e8;
    --msg-assistant-bg: #2d1f4a;
    --msg-assistant-label: #b99fff;
    --msg-assistant-text: #e0d5ff;
    --msg-system-bg: #3a3220;
    --msg-system-label: #d4b45a;
    --msg-system-text: #dcc898;
    --msg-tool-bg: #4a2f15;
    --msg-tool-label: #ffb366;
    --msg-tool-text: #f0d4b8;
    --msg-error-bg: #4a1a1a;
    --msg-error-label: #ff7070;
    --msg-error-text: #ffb3b3;
    --msg-other-bg: #1a3a2e;
    --msg-other-label: #7eddcb;
    --msg-other-text: #d0f0e8;
  }
}

.message-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-radius: 12px;
  background: var(--bg);
  padding: 10px 12px;
  font-size: 13px;
}

.header {
  display: flex;
  align-items: center;
  gap: 6px;
}

:deep(.q-icon) {
  color: var(--label-color);
}

.label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--label-color);
}

.content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.5;
  margin: 0;
  color: inherit;
}

.content.mono {
  font-family: var(--mt-mono);
  font-size: 12px;
}

.content {
  color: var(--msg-user-text);
}

.role-user .content {
  color: var(--msg-user-text);
}
.role-assistant .content {
  color: var(--msg-assistant-text);
}
.role-system .content {
  color: var(--msg-system-text);
}
.role-tool .content {
  color: var(--msg-tool-text);
}
.role-error .content {
  color: var(--msg-error-text);
}
.role-other .content {
  color: var(--msg-other-text);
}
</style>
