<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import TraceTimeline from "./TraceTimeline.vue";

/**
 * Panel de vista previa de la lista de Conversations (ADR-048): permite leer una conversación o una traza sin
 * salir de la lista. Es presentacional: la página decide qué cargar y qué mostrar.
 */
export interface PreviewMessage {
  role: "user" | "assistant";
  text: string;
  /** trace of the turn this assistant reply belongs to: its timeline is shown under the reply */
  traceId?: string;
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
  /** muestra Annotate / Add to queue / Add to dataset; se desactivan si no hay una traza sobre la que actuar */
  actionsDisabled?: boolean;
  actionsHint?: string;
  showActions?: boolean;
}>();
defineEmits<{ open: []; close: []; annotate: []; addToQueue: []; addToDataset: [] }>();

// The panel can be widened by dragging its left edge (or with the arrow keys); the width is remembered per browser.
const DEFAULT_WIDTH = 500;
const MIN_WIDTH = 400;
const STORAGE_KEY = "mt.preview.width";
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(1100, Math.round(window.innerWidth * 0.75)));
const clampWidth = (w: number) => Math.min(Math.max(Math.round(w), MIN_WIDTH), maxWidth());
const stored = (() => {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(n) && n > 0 ? clampWidth(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
})();
const width = ref(stored);
const dragging = ref(false);
function remember() {
  try {
    localStorage.setItem(STORAGE_KEY, String(width.value));
  } catch {
    /* private mode: the width just is not remembered */
  }
}
let startX = 0;
let startWidth = 0;
const onMove = (e: PointerEvent) => (width.value = clampWidth(startWidth + (startX - e.clientX)));
function stopDrag() {
  if (!dragging.value) return;
  dragging.value = false;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", stopDrag);
  remember();
}
function startDrag(e: PointerEvent) {
  startX = e.clientX;
  startWidth = width.value;
  dragging.value = true;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stopDrag);
}
function nudge(delta: number) {
  width.value = clampWidth(width.value + delta);
  remember();
}
function reset() {
  width.value = DEFAULT_WIDTH;
  remember();
}
onBeforeUnmount(stopDrag);
</script>

<template>
  <aside class="preview mt-card" :class="{ dragging }" :style="{ width: `${width}px` }" aria-label="Preview">
    <div
      class="resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview"
      :aria-valuenow="width"
      :aria-valuemin="MIN_WIDTH"
      tabindex="0"
      title="Drag to resize · double-click to reset"
      data-testid="preview-resize"
      @pointerdown.prevent="startDrag"
      @dblclick="reset"
      @keydown.left.prevent="nudge(40)"
      @keydown.right.prevent="nudge(-40)"
    />
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
          <TraceTimeline v-if="m.role === 'assistant' && m.traceId" :key="m.traceId" :trace-id="m.traceId" />
        </div>
      </template>
      <p v-else class="state muted">{{ emptyHint ?? "No content was captured for this item." }}</p>
    </div>

    <footer class="foot">
      <div v-for="s in stats" :key="s.k" class="stat">
        <span class="k">{{ s.k }}</span>
        <span class="v mono">{{ s.v }}</span>
      </div>
      <div v-if="showActions" class="actions" :title="actionsHint">
        <button type="button" class="btn primary" data-testid="preview-annotate" :disabled="actionsDisabled" @click="$emit('annotate')">Annotate</button>
        <button type="button" class="btn" data-testid="preview-add-to-queue" :disabled="actionsDisabled" @click="$emit('addToQueue')">Add to queue</button>
        <button type="button" class="btn" data-testid="preview-add-to-dataset" :disabled="actionsDisabled" @click="$emit('addToDataset')">Add to dataset</button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.preview {
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--mt-radius-lg);
}
.resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}
.resize:hover,
.resize:focus-visible,
.dragging .resize {
  background: var(--mt-accent-soft);
  outline: none;
}
.dragging {
  user-select: none;
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
.bubble.assistant {
  max-width: 100%;
}
.bubble.assistant p {
  align-self: flex-start;
  max-width: 92%;
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
.actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 8px;
}
.btn {
  height: 34px;
  padding: 0 14px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary {
  flex: 1;
  border-color: var(--mt-accent);
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font-weight: 800;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
