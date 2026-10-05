<script setup lang="ts">
import type { Turn } from "@/domain/review-thread";

/**
 * A conversation read like a chat (ADR-048): the user on the right, the assistant on the left, tool calls as quiet
 * one-liners and tool data folded away. `answerLabel` names the reply the viewer is looking at, when there is one.
 */
defineProps<{ turns: Turn[]; answerLabel?: string }>();
</script>

<template>
  <div class="thread" data-testid="thread">
    <template v-for="(turn, i) in turns" :key="i">
      <div v-if="turn.kind === 'user'" class="turn user">
        <span class="who">User</span>
        <p>{{ turn.text }}</p>
      </div>
      <div v-else-if="turn.kind === 'action'" class="action" data-testid="turn-action">
        <q-icon name="build_circle" size="16px" />
        <span>{{ turn.summary }}</span>
      </div>
      <details v-else-if="turn.kind === 'data'" class="data" data-testid="turn-data">
        <summary>
          <q-icon name="dataset" size="16px" />
          <span>Data retrieved{{ turn.source ? ` by ${turn.source}` : "" }}</span>
          <span class="toggle"><span class="when-closed">Show</span><span class="when-open">Hide</span><q-icon name="expand_more" size="18px" class="chev" /></span>
        </summary>
        <pre>{{ turn.json }}</pre>
      </details>
      <div v-else-if="turn.kind === 'answer'" class="turn answer" data-testid="turn-answer">
        <span class="who"><q-icon name="rate_review" size="14px" /> {{ answerLabel ?? "Assistant reply" }}</span>
        <p>{{ turn.text }}</p>
      </div>
      <div v-else class="turn assistant">
        <span class="who">Assistant</span>
        <p>{{ turn.text }}</p>
      </div>
    </template>
    <slot />
  </div>
</template>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.turn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 82%;
}
.turn p {
  margin: 0;
  padding: 10px 14px;
  line-height: 1.55;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--mt-ink);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
  border-radius: var(--mt-radius-lg) var(--mt-radius-lg) var(--mt-radius-lg) 2px;
}
.turn.user {
  align-self: flex-end;
}
.turn.user .who {
  text-align: right;
}
.turn.user p {
  background: var(--mt-soft);
  border-radius: var(--mt-radius-lg) var(--mt-radius-lg) 2px var(--mt-radius-lg);
}
.turn.answer {
  max-width: 90%;
}
.turn.answer p {
  background: var(--mt-accent-tint);
  border-color: var(--mt-accent-soft);
}
.turn.answer .who {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--mt-accent-text);
}
.who {
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mt-muted);
}
.action {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 82%;
  padding: 8px 12px;
  border: 1px dashed var(--mt-line);
  border-radius: var(--mt-radius-sm);
  color: var(--mt-muted);
  font-size: 12.5px;
}
.data {
  max-width: 82%;
  padding: 8px 12px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  font-size: 12.5px;
  color: var(--mt-muted);
}
.data summary {
  display: flex;
  align-items: center;
  gap: 6px;
  list-style: none;
  cursor: pointer;
  font-weight: 600;
}
.data summary::-webkit-details-marker {
  display: none;
}
.data .toggle {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  font-weight: 700;
  font-size: 12px;
  color: var(--mt-accent-text);
}
.data .when-open,
.data[open] .when-closed {
  display: none;
}
.data[open] .when-open {
  display: inline;
}
.chev {
  transition: transform 0.15s;
}
.data[open] .chev {
  transform: rotate(180deg);
}
.data pre {
  margin: 8px 0 0;
  padding: 8px;
  max-height: 240px;
  overflow: auto;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  color: var(--mt-ink);
  font-family: var(--mt-mono);
  font-size: 11.5px;
}
</style>
