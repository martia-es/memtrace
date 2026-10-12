<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ConversationStep } from "@/domain/conversation-steps";
import { formatCostUsd, formatCount, formatDuration } from "@/domain/format";
import Pill from "./Pill.vue";
import Button from "./Button.vue";

/**
 * How a reply was built, step by step and without JSON: guardrails passed, passages retrieved, tools called and the reply
 * written. Retrieval and tool steps (and any step that failed) start open; the rest fold to one line. `canOpenTrace`
 * adds the link from each step to its span in the technical trace.
 */
const props = defineProps<{ steps: ConversationStep[]; canOpenTrace: boolean }>();
const emit = defineEmits<{ "open-span": [spanId: string] }>();

const startsOpen = (s: ConversationStep) => s.kind === "retrieval" || s.kind === "tool" || s.failed;
const open = ref<Set<string>>(new Set());
watch(() => props.steps, (steps) => (open.value = new Set(steps.filter(startsOpen).map((s) => s.spanId))), { immediate: true });
const toggle = (id: string) => {
  const next = new Set(open.value);
  if (!next.delete(id)) next.add(id);
  open.value = next;
};
const openAll = () => (open.value = new Set(props.steps.map((s) => s.spanId)));
const closeAll = () => (open.value = new Set());
const allOpen = computed(() => props.steps.every((s) => open.value.has(s.spanId)));

const LOW_SCORE = 0.5;
const summary = computed(() => {
  const passages = props.steps.reduce((n, s) => n + (s.kind === "retrieval" ? s.chunks.length : 0), 0);
  const tools = props.steps.filter((s) => s.kind === "tool").length;
  const parts = [`${props.steps.length} ${props.steps.length === 1 ? "step" : "steps"}`];
  if (passages) parts.push(`${passages} ${passages === 1 ? "passage" : "passages"}`);
  if (tools) parts.push(`${tools} tool ${tools === 1 ? "call" : "calls"}`);
  return parts.join(" · ");
});

const ICON: Record<ConversationStep["kind"], string> = { guardrails: "verified_user", retrieval: "search", tool: "build", reply: "auto_awesome" };
const title = (s: ConversationStep): string => {
  if (s.kind === "guardrails") return s.failed ? "Blocked the message" : "Checked the message";
  if (s.kind === "retrieval") return "Searched the knowledge base";
  if (s.kind === "tool") return `Called ${s.label}`;
  return "Wrote the reply";
};
const detail = (s: ConversationStep): string => {
  if (s.kind === "guardrails") return s.failed ? (s.error ?? "") : `${s.checks.map((c) => c.name.toLowerCase()).join(", ")}: all passed`;
  if (s.kind === "retrieval") return s.chunks.length ? `${s.chunks.length} ${s.chunks.length === 1 ? "passage" : "passages"} found` : "No passages saved for this search";
  if (s.kind === "tool") return s.failed ? (s.error ?? "") : "";
  return [s.model, s.tokens ? `${formatCount(s.tokens)} tokens` : null, formatCostUsd(s.costUsd)].filter(Boolean).join(" · ");
};
const pct = (score: number) => Math.round(Math.min(Math.max(score, 0), 1) * 100);
</script>

<template>
  <section class="steps" aria-label="How the answer was built" data-testid="conversation-steps">
    <div class="intro">
      <span class="label">How the answer was built</span>
      <span class="summary">{{ summary }}</span>
      <span class="rule" />
      <Button variant="link" data-testid="steps-toggle-all" @click="allOpen ? closeAll() : openAll()">{{ allOpen ? "Collapse all" : "Expand all" }}</Button>
    </div>

    <ol class="list">
      <li v-for="(s, i) in steps" :key="s.spanId" class="step" :class="[`kind-${s.kind}`, { failed: s.failed }]" data-testid="conversation-step">
        <div class="rail">
          <span class="dot"><q-icon :name="s.failed ? 'error_outline' : ICON[s.kind]" size="15px" /></span>
          <span v-if="i < steps.length - 1" class="line" />
        </div>
        <div class="card" :class="{ open: open.has(s.spanId) }">
          <button type="button" class="head" :aria-expanded="open.has(s.spanId)" @click="toggle(s.spanId)">
            <span class="title">{{ title(s) }}</span>
            <code v-if="s.kind === 'tool'" class="fn">{{ s.name }}</code>
            <Pill v-if="s.kind === 'tool'" :tone="s.failed ? 'error' : 'ok'">{{ s.failed ? "Failed" : "OK" }}</Pill>
            <span class="detail" :class="{ err: s.failed }">{{ detail(s) }}</span>
            <span class="time mono">{{ formatDuration(s.durationMs) }}</span>
            <q-icon name="expand_more" size="18px" class="chev" />
          </button>

          <div v-if="open.has(s.spanId)" class="content">
            <template v-if="s.kind === 'guardrails'">
              <ul class="checks">
                <li v-for="c in s.checks" :key="c.spanId" :class="{ bad: c.failed }"><q-icon :name="c.failed ? 'close' : 'check'" size="14px" />{{ c.name }}</li>
              </ul>
            </template>

            <template v-else-if="s.kind === 'retrieval'">
              <p v-if="s.query" class="query">Query <code>{{ s.query }}</code></p>
              <ul v-if="s.chunks.length" class="chunks">
                <li v-for="c in s.chunks" :key="c.rank" class="chunk" :class="{ low: c.score !== null && c.score < LOW_SCORE }" data-testid="step-chunk">
                  <div class="chunk-body">
                    <span class="source">{{ c.source ?? `Passage ${c.rank}` }}</span>
                    <span class="text">{{ c.text || "The text of this passage was not saved." }}</span>
                  </div>
                  <div v-if="c.score !== null" class="score">
                    <span class="bar"><span :style="{ width: `${pct(c.score)}%` }" /></span>
                    <span class="mono">{{ c.score.toFixed(2) }}</span>
                    <Pill v-if="c.score < LOW_SCORE" tone="warn">Low match</Pill>
                  </div>
                </li>
              </ul>
              <p v-else class="muted">The passages are saved when content capture is on for the agent (<code>MEMTRACE_CAPTURE_CONTENT=true</code>).</p>
            </template>

            <template v-else-if="s.kind === 'tool'">
              <div class="pair">
                <div>
                  <span class="cap">What it asked</span>
                  <dl v-if="s.asked.length" class="kv"><template v-for="f in s.asked" :key="f.key"><dt>{{ f.key }}</dt><dd>{{ f.value }}</dd></template></dl>
                  <p v-else class="muted">Nothing saved.</p>
                </div>
                <div>
                  <span class="cap">{{ s.failed ? "What went wrong" : "What it returned" }}</span>
                  <p v-if="s.failed" class="err-text">{{ s.error }}</p>
                  <dl v-else-if="s.returned.length" class="kv"><template v-for="f in s.returned" :key="f.key"><dt>{{ f.key }}</dt><dd>{{ f.value }}</dd></template></dl>
                  <p v-else-if="s.returnedText" class="plain">{{ s.returnedText }}</p>
                  <p v-else class="muted">Nothing saved.</p>
                </div>
              </div>
            </template>

            <p v-else-if="s.failed" class="err-text">{{ s.error }}</p>

            <Button v-if="canOpenTrace" variant="link" class="to-trace" data-testid="open-in-trace" @click="emit('open-span', s.spanId)">Open in technical trace →</Button>
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 900px;
}
.intro {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.label {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.summary {
  color: var(--mt-muted);
}
.rule {
  flex: 1;
  height: 1px;
  background: var(--mt-line);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.step {
  display: flex;
  gap: 12px;
}
.rail {
  width: 28px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--mt-accent-soft);
  color: var(--mt-accent-text);
}
.kind-guardrails .dot {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.kind-tool .dot {
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
}
.kind-reply .dot {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.step.failed .dot {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.line {
  flex: 1;
  width: 2px;
  margin: 3px 0;
  background: var(--mt-line);
}
.card {
  flex: 1;
  min-width: 0;
  margin-bottom: 10px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  overflow: hidden;
}
.card.open {
  border-color: var(--mt-accent-soft);
}
.step.failed .card {
  border-color: var(--mt-err);
}
.head {
  width: 100%;
  min-height: 40px;
  box-sizing: border-box;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.head:hover {
  background: var(--mt-soft-2);
}
.head:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: -2px;
}
.title {
  font-weight: 700;
  white-space: nowrap;
}
.fn {
  padding: 1px 6px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-soft);
  font-family: var(--mt-mono);
  font-size: 11.5px;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mt-muted);
}
.detail.err {
  color: var(--mt-err-ink);
}
.time {
  font-size: 11.5px;
  color: var(--mt-muted);
}
.chev {
  color: var(--mt-faint);
  transition: transform 0.15s;
}
.card.open .chev {
  transform: rotate(180deg);
}
.content {
  padding: 4px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--mt-line-2);
}
.query {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--mt-muted);
}
.query code {
  font-family: var(--mt-mono);
  font-size: 11.5px;
  color: var(--mt-ink);
}
.checks {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.checks li {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--mt-ok-ink);
  font-weight: 600;
}
.checks li.bad {
  color: var(--mt-err-ink);
}
.chunks {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chunk {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 170px;
  gap: 14px;
  padding: 9px 12px;
  border: 1px solid var(--mt-line-2);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft-2);
}
.chunk.low {
  opacity: 0.85;
}
.chunk-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.source {
  font-weight: 700;
  font-size: 12.5px;
}
.text {
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--mt-muted);
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.score {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  font-size: 11.5px;
}
.bar {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--mt-line);
  overflow: hidden;
  display: block;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--mt-accent);
}
.chunk.low .bar span {
  background: var(--mt-warn);
}
.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding-top: 8px;
}
.cap {
  display: block;
  margin-bottom: 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.kv {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(80px, max-content) minmax(0, 1fr);
  column-gap: 14px;
}
.kv dt,
.kv dd {
  margin: 0;
  padding: 5px 0;
  border-bottom: 1px solid var(--mt-line-2);
  overflow-wrap: anywhere;
}
.kv dt {
  color: var(--mt-muted);
  text-transform: capitalize;
}
.kv dd {
  font-weight: 700;
}
.plain,
.err-text,
.muted {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.muted {
  color: var(--mt-muted);
}
.err-text {
  color: var(--mt-err-ink);
}
.to-trace {
  align-self: flex-start;
}
@media (max-width: 800px) {
  .pair,
  .chunk {
    grid-template-columns: minmax(0, 1fr);
  }
  .score {
    align-items: stretch;
  }
}
</style>
