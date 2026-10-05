<script setup lang="ts">
/**
 * Panel de vista previa de la lista de Conversations (ADR-048): permite leer una conversación o una traza sin
 * salir de la lista. Es presentacional: la página decide qué cargar y qué mostrar.
 */
export interface PreviewMessage {
  role: "user" | "assistant";
  text: string;
}
export interface PreviewStat {
  k: string;
  v: string;
}

defineProps<{
  title: string;
  subtitle: string;
  stats: PreviewStat[];
  messages: PreviewMessage[];
  loading?: boolean;
  /** se muestra en lugar de los mensajes cuando no hay contenido capturado */
  emptyHint?: string;
  openLabel?: string;
}>();
defineEmits<{ open: []; close: [] }>();
</script>

<template>
  <aside class="preview mt-card" aria-label="Preview">
    <header class="head">
      <div class="head-top">
        <span class="eyebrow">PREVIEW</span>
        <button type="button" class="link" data-testid="preview-open" @click="$emit('open')">{{ openLabel ?? "Open full view" }} ↗</button>
        <button type="button" class="close" aria-label="Close preview" data-testid="preview-close" @click="$emit('close')">✕</button>
      </div>
      <h2 class="title" :title="title">{{ title }}</h2>
      <span class="sub mono">{{ subtitle }}</span>
    </header>

    <div class="thread">
      <div v-if="loading" class="state"><q-spinner size="22px" color="primary" /></div>
      <template v-else-if="messages.length">
        <div v-for="(m, i) in messages" :key="i" class="bubble" :class="m.role">
          <span class="who">{{ m.role === "user" ? "USER" : "ASSISTANT" }}</span>
          <p>{{ m.text }}</p>
        </div>
      </template>
      <p v-else class="state muted">{{ emptyHint ?? "No content was captured for this item." }}</p>
    </div>

    <footer class="foot">
      <div v-for="s in stats" :key="s.k" class="stat">
        <span class="k">{{ s.k }}</span>
        <span class="v mono">{{ s.v }}</span>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.preview {
  width: 400px;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--mt-radius-lg);
}
.head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--mt-line);
}
.head-top {
  display: flex;
  align-items: center;
  gap: 10px;
}
.eyebrow {
  flex: 1;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mt-faint);
}
.link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  color: var(--mt-accent-text);
  cursor: pointer;
}
.link:hover {
  text-decoration: underline;
}
.close {
  border: 0;
  background: none;
  padding: 2px 4px;
  color: var(--mt-faint);
  font-size: 14px;
  cursor: pointer;
}
.title {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.01em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.sub {
  font-size: 11.5px;
  color: var(--mt-muted);
  overflow-wrap: anywhere;
}
.thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--mt-bg);
}
.bubble {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 90%;
}
.bubble.user {
  align-self: flex-end;
}
.who {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--mt-faint);
}
.bubble.user .who {
  text-align: right;
}
.bubble p {
  margin: 0;
  padding: 9px 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  border-radius: var(--mt-radius-lg) var(--mt-radius-lg) 2px var(--mt-radius-lg);
}
.bubble.assistant p {
  background: var(--mt-accent-tint);
  border-color: var(--mt-accent-soft);
  border-radius: var(--mt-radius-lg) var(--mt-radius-lg) var(--mt-radius-lg) 2px;
}
.state {
  display: flex;
  justify-content: center;
  padding: 24px 0;
  margin: 0;
}
.muted {
  color: var(--mt-muted);
  text-align: center;
}
.foot {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--mt-line);
}
.stat {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
}
.k {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mt-faint);
}
.v {
  font-size: 12.5px;
  font-weight: 500;
}
</style>
