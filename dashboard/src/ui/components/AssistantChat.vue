<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { describeApiError } from "@/application/describe-api-error";
import { nextVote, normalizeDraft, type ChatMessage } from "@/domain/chat-dock";
import ThumbIcon from "./ThumbIcon.vue";
import { useAssistantApi } from "../composables/useAssistantApi";
import { useChatDock } from "../composables/useChatDock";
import Button from "./Button.vue";

/** Conversación con un agente (mensajes, votos y caja de texto). La comparten los tres modos de visualización (ADR-063). */
const props = defineProps<{ displayName: string; large?: boolean }>();
const api = useAssistantApi();
const { state } = useChatDock();

const draft = ref("");
const sending = ref(false);
const scroller = ref<HTMLElement | null>(null);
let controller: AbortController | null = null;

/** los mensajes pueden venir de otra pestaña (relevo a pantalla completa), así que el id sigue al mayor existente */
const newId = () => state.messages.reduce((max, m) => Math.max(max, m.id), 0) + 1;

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
  state.messages.push({ id: newId(), role: "user", text });
  sending.value = true;
  controller = new AbortController();
  try {
    const answer = await api.chat(target.experimentId, target.deploymentId, text, state.sessionId, controller.signal);
    if (state.target !== target) return;
    state.sessionId = answer.sessionId;
    state.messages.push({ id: newId(), role: "agent", text: answer.reply, traceId: answer.traceId, vote: null });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    state.messages.push({ id: newId(), role: "error", text: describeApiError(error as Error) });
  } finally {
    sending.value = false;
  }
}

/** 👍/👎 sobre la respuesta: se guarda en su traza. Pulsar el mismo botón otra vez no hace nada en el servidor (el voto se mantiene). */
const voteError = ref<string | null>(null);
async function vote(message: ChatMessage, rating: 1 | -1) {
  const target = state.target;
  if (!target || !message.traceId) return;
  const next = nextVote(message.vote, rating);
  if (next === null) return; // retirar el voto no se ofrece desde el chat de prueba: basta con cambiarlo
  const previous = message.vote ?? null;
  message.vote = next;
  voteError.value = null;
  try {
    await api.sendFeedback(target.experimentId, message.traceId, next);
  } catch (error) {
    message.vote = previous;
    voteError.value = describeApiError(error as Error);
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
  <div class="chat" :class="{ large }">
    <div ref="scroller" class="msgs" aria-live="polite">
      <p v-if="state.messages.length === 0" class="empty">Ask {{ props.displayName }} something. This runs against {{ state.target?.environmentLabel }}.</p>
      <template v-for="m in state.messages" :key="m.id">
        <div class="msg" :class="m.role">{{ m.text }}</div>
        <div v-if="m.role === 'agent' && m.traceId" class="votes" role="group" aria-label="Rate this answer">
          <Button variant="icon" size="sm" class="vote" :class="{ on: m.vote === 1 }" :aria-pressed="m.vote === 1" title="Good answer" aria-label="Good answer" data-testid="vote-up" @click="vote(m, 1)"><ThumbIcon direction="up" :size="15" :filled="m.vote === 1" /></Button>
          <Button variant="icon" size="sm" class="vote" :class="{ on: m.vote === -1 }" :aria-pressed="m.vote === -1" title="Bad answer" aria-label="Bad answer" data-testid="vote-down" @click="vote(m, -1)"><ThumbIcon direction="down" :size="15" :filled="m.vote === -1" /></Button>
        </div>
      </template>
      <div v-if="voteError" class="msg error" role="alert">{{ voteError }}</div>
      <div v-if="sending" class="msg agent typing" aria-label="Waiting for the answer">…</div>
    </div>
    <form class="compose" @submit.prevent="send">
      <textarea v-model="draft" rows="1" placeholder="Write a message" aria-label="Message" data-testid="chat-input" @keydown="onKey" />
      <Button variant="primary" type="submit" class="send" :disabled="sending || normalizeDraft(draft) === null" data-testid="chat-send">Send</Button>
    </form>
  </div>
</template>

<style scoped>
/* Todo sale de tokens --mt-* para que el tema de la organización (acento, esquinas, fuente) llegue al chat (ADR-063). */
.chat { display: flex; flex-direction: column; flex: 1; min-height: 0; font-family: var(--mt-sans); }
.msgs { flex: 1; display: flex; flex-direction: column; gap: 8px; padding: 12px; overflow-y: auto; }
.empty { margin: auto 0; text-align: center; font-size: 13px; color: var(--mt-muted); }
.msg { max-width: 85%; padding: 8px 11px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; border-radius: calc(var(--mt-radius-lg) + 4px); }
.msg.user { align-self: flex-end; color: var(--mt-accent-ink); background: var(--mt-accent); border-bottom-right-radius: var(--mt-radius-xs); }
.msg.agent { align-self: flex-start; color: var(--mt-ink); background: color-mix(in srgb, var(--mt-accent) 9%, var(--mt-card)); border-bottom-left-radius: var(--mt-radius-xs); }
.msg.error { align-self: flex-start; color: var(--mt-err-ink); border: 1px solid var(--mt-err); }
.typing { color: var(--mt-muted); }
.votes { display: flex; gap: 4px; align-self: flex-start; margin: -4px 0 0 6px; }


.vote.on { color: var(--mt-accent-text); background: var(--mt-accent-soft); border-color: var(--mt-accent); }

.compose { display: flex; align-items: flex-end; gap: 8px; padding: 8px; border-top: 1px solid var(--mt-line); }
.compose textarea { flex: 1; box-sizing: border-box; min-height: 34px; max-height: 110px; padding: 7px 10px; font: inherit; font-size: 13px; color: var(--mt-ink); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); resize: none; field-sizing: content; }
.compose textarea:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 1px; }


.large .msgs { padding: 24px max(16px, 14%); }
.large .msg, .large .compose textarea { font-size: 14px; }
.large .compose { padding: 12px max(16px, 14%) 20px; }
</style>
