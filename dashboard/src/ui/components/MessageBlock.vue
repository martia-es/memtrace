<script setup lang="ts">
import type { IoBlock } from "@/domain/span-io";

defineProps<{ block: IoBlock }>();

const icon = (role: IoBlock["role"]) =>
  ({ user: "person", assistant: "smart_toy", system: "settings", tool: "build", error: "error_outline", other: "chat" })[role];

const roleName = (role: IoBlock["role"]) =>
  ({
    user: "Humano",
    assistant: "IA",
    system: "Sistema",
    tool: "Herramienta",
    error: "Error",
    other: "Otro",
  })[role];
</script>

<template>
  <div class="message-block" :class="`role-${block.role}`">
    <div class="header">
      <div class="role-badge">
        <q-icon :name="icon(block.role)" size="18px" />
        <span class="role-name">{{ roleName(block.role) }}</span>
      </div>
      <div class="label-tag">{{ block.label }}</div>
    </div>
    <div class="content-wrapper">
      <pre v-if="block.structured" class="content mono">{{ block.text }}</pre>
      <div v-else class="content">{{ block.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.message-block {
  border: 2px solid transparent;
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 8px;
}

.message-block.role-user {
  background: #e8f5e9;
  border-color: #81c784;
}
.message-block.role-assistant {
  background: #f3e5f5;
  border-color: #ba68c8;
}
.message-block.role-system {
  background: #fff3e0;
  border-color: #ffb74d;
}
.message-block.role-tool {
  background: #ffe0b2;
  border-color: #ff9800;
}
.message-block.role-error {
  background: #ffebee;
  border-color: #e53935;
}
.message-block.role-other {
  background: #eceff1;
  border-color: #78909c;
}

@media (prefers-color-scheme: dark) {
  .message-block.role-user {
    background: #1b5e20;
    border-color: #66bb6a;
    color: #c8e6c9;
  }
  .message-block.role-assistant {
    background: #4a148c;
    border-color: #ba68c8;
    color: #e1bee7;
  }
  .message-block.role-system {
    background: #e65100;
    border-color: #ffb74d;
    color: #ffe0b2;
  }
  .message-block.role-tool {
    background: #bf360c;
    border-color: #ff9800;
    color: #ffcc80;
  }
  .message-block.role-error {
    background: #b71c1c;
    border-color: #ef5350;
    color: #ef9a9a;
  }
  .message-block.role-other {
    background: #263238;
    border-color: #90a4ae;
    color: #cfd8dc;
  }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid currentColor;
  opacity: 0.7;
}

.role-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

:deep(.q-icon) {
  flex-shrink: 0;
}

.role-name {
  font-weight: 700;
}

.label-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: currentColor;
  opacity: 0.15;
  color: inherit;
  white-space: nowrap;
}

.content-wrapper {
  flex: 1;
  min-width: 0;
}

.content {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  padding: 0;
  font-family: inherit;
  color: inherit;
}

.content.mono {
  font-family: var(--mt-mono);
  font-size: 12px;
  background: rgba(0, 0, 0, 0.05);
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
}

@media (prefers-color-scheme: dark) {
  .content.mono {
    background: rgba(255, 255, 255, 0.08);
  }
}
</style>
