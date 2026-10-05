<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { describeApiError } from "@/application/describe-api-error";
import { normalizeDraft } from "@/domain/chat-dock";
import { useAssistantApi } from "../composables/useAssistantApi";
import { useChatDock } from "../composables/useChatDock";

/** Mini chat flotante (abajo a la derecha) para hablar con un agente desde su ficha, sin salir de MemTrace (ADR-055). */
const api = useAssistantApi();
const dock = useChatDock();
const { state } = dock;

const draft = ref("");
const sending = ref(false);
const scroller = ref<HTMLElement | null>(null);
let nextId = 1;
let controller: AbortController | null = null;

const scrollDown = () => void nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  });
watch(() => state.messages.length, scrollDown);
watch(() => state.target, () => {
  controller?.abort();
  sending.value = false;
});

async function send() {
  const target = state.target;
  const text = normalizeDraft(draft.value);
  if (!target || text === null || sending.value) return;
  draft.value = "";
  state.messages.push({ id: nextId++, role: "user", text });
  sending.value = true;
  controller = new AbortController();
  try {
    const answer = await api.chat(target.experimentId, target.deploymentId, text, state.sessionId, controller.signal);
    if (state.target !== target) return;
    state.sessionId = answer.sessionId;
    state.messages.push({ id: nextId++, role: "agent", text: answer.reply });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    state.messages.push({ id: nextId++, role: "error", text: describeApiError(error as Error) });
  } finally {
    sending.value = false;
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}
</script>

<template>
  <div v-if="state.target && state.maximized && !state.minimized" class="backdrop" @click="state.maximized = false" />
  <aside v-if="state.target" class="dock" :class="{ min: state.minimized, max: state.maximized && !state.minimized }" @keydown.esc="state.maximized = false" role="dialog" :aria-label="`Chat with ${state.target.agentName}`" data-testid="chat-dock">
    <header class="bar">
      <button type="button" class="title" :aria-expanded="!state.minimized" @click="state.minimized = !state.minimized">
        <span class="dot" aria-hidden="true" />
        <b>{{ state.target.agentName }}</b>
        <span class="env">{{ state.target.environmentLabel }}</span>
      </button>
      <button v-if="!state.minimized && state.messages.length > 0" type="button" class="icon" title="New conversation" aria-label="New conversation" @click="dock.reset()">↺</button>
      <button v-if="!state.minimized" type="button" class="icon" :title="state.maximized ? 'Restore size' : 'Maximize'" :aria-label="state.maximized ? 'Restore size' : 'Maximize'" data-testid="chat-maximize" @click="state.maximized = !state.maximized">{{ state.maximized ? "⤡" : "⤢" }}</button>
      <button type="button" class="icon" :title="state.minimized ? 'Expand' : 'Minimize'" :aria-label="state.minimized ? 'Expand' : 'Minimize'" @click="state.minimized = !state.minimized">{{ state.minimized ? "▢" : "–" }}</button>
      <button type="button" class="icon" title="Close" aria-label="Close chat" data-testid="chat-close" @click="dock.close()">✕</button>
    </header>
    <template v-if="!state.minimized">
      <div ref="scroller" class="msgs" aria-live="polite">
        <p v-if="state.messages.length === 0" class="empty">Ask {{ state.target.agentName }} something. This runs against {{ state.target.environmentLabel }}.</p>
        <div v-for="m in state.messages" :key="m.id" class="msg" :class="m.role">{{ m.text }}</div>
        <div v-if="sending" class="msg agent typing" aria-label="Waiting for the answer">…</div>
      </div>
      <form class="compose" @submit.prevent="send">
        <textarea v-model="draft" rows="1" placeholder="Write a message" aria-label="Message" data-testid="chat-input" @keydown="onKey" />
        <button type="submit" class="send" :disabled="sending || normalizeDraft(draft) === null" data-testid="chat-send">Send</button>
      </form>
    </template>
  </aside>
</template>

<style scoped>
.dock { position: fixed; right: 20px; bottom: 20px; z-index: 50; display: flex; flex-direction: column; width: 440px; max-width: calc(100vw - 24px); height: 640px; max-height: calc(100vh - 40px); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18); overflow: hidden; }
.dock.min { height: auto; width: 300px; }
.dock.max { inset: 4vh 4vw; width: auto; height: auto; max-width: none; max-height: none; z-index: 61; }
.backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.45); }
.dock.max .msgs { padding: 20px max(16px, 12%); }
.dock.max .msg, .dock.max .compose textarea { font-size: 14px; }
.dock.max .compose { padding: 12px max(16px, 12%); }
.bar { display: flex; align-items: center; gap: 2px; padding: 6px 6px 6px 12px; border-bottom: 1px solid var(--mt-line); }
.dock.min .bar { border-bottom: none; }
.title { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 4px 0; font: inherit; font-size: 13px; color: var(--mt-ink); background: none; border: none; cursor: pointer; text-align: left; }
.title b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--mt-accent); }
.env { flex: none; font-family: var(--mt-mono); font-size: 11px; color: var(--mt-muted); }
.icon { width: 28px; height: 28px; font: inherit; font-size: 14px; color: var(--mt-muted); background: none; border: none; border-radius: var(--mt-radius-sm); cursor: pointer; }
.icon:hover { color: var(--mt-ink); background: var(--mt-line); }
.title:focus-visible, .icon:focus-visible, .send:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
.msgs { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 12px; overflow-y: auto; }
.empty { margin: auto 0; text-align: center; font-size: 13px; color: var(--mt-muted); }
.msg { max-width: 85%; padding: 8px 11px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: 12px; }
.msg.user { align-self: flex-end; color: var(--mt-accent-ink); background: var(--mt-accent); border-bottom-right-radius: 4px; }
.msg.agent { align-self: flex-start; color: var(--mt-ink); background: var(--mt-line); border-bottom-left-radius: 4px; }
.msg.error { align-self: flex-start; color: var(--mt-err-ink); border: 1px solid var(--mt-err); }
.typing { color: var(--mt-muted); }
.compose { display: flex; align-items: flex-end; gap: 8px; padding: 8px; border-top: 1px solid var(--mt-line); }
.compose textarea { flex: 1; box-sizing: border-box; min-height: 34px; max-height: 110px; padding: 7px 10px; font: inherit; font-size: 13px; color: var(--mt-ink); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); resize: none; field-sizing: content; }
.compose textarea:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 1px; }
.send { height: 34px; padding: 0 14px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-ink); background: var(--mt-accent); border: none; border-radius: var(--mt-radius-sm); cursor: pointer; }
.send:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 480px) { .dock { right: 12px; bottom: 12px; } }
</style>
