<script setup lang="ts">
import type { SpanNodeDto } from "@contract";
import { computed, ref } from "vue";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import { kindMeta } from "@/domain/meta";
import { genAiRows, spanIo, type IoBlock } from "@/domain/span-io";
import IoPanel from "./IoPanel.vue";

const props = defineProps<{ node: SpanNodeDto; emptyHint: string }>();

const parseMetadataRows = (raw: string | undefined): [string, string | number][] => {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as [string, string]);
    }
    if (Array.isArray(parsed)) {
      return [["value", parsed.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")]];
    }
  } catch {
    // the value is already plain text: show as-is
  }

  return [["value", raw]];
};

const cur = computed(() => {
  const n = props.node;
  const io = spanIo(n);
  const chat = n.content?.inputMessages !== undefined;
  const output: IoBlock[] = n.status.code === "error" ? [{ label: "error", text: n.status.message || "The span ended with an error", structured: false, role: "error" }, ...io.output] : io.output;
  const g = n.genAi;
  const tokens = g && (g.totalTokens ?? (g.inputTokens ?? 0) + (g.outputTokens ?? 0));
  const stat = (k: string, v: string | null) => (v ? { k, v } : null);
  const metaTags = (() => {
    const raw = n.attributes["memtrace.tags"];
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return [["Tags", parsed.map(String).join(", ")]] as [string, string][];
    } catch {
      // fallback
    }
    return [["Tags", raw]] as [string, string][];
  })();

  return {
    kind: kindMeta(n.kind),
    io,
    output,
    inBadge: chat ? `${io.input.length} ${io.input.length === 1 ? "message" : "messages"}` : n.content?.toolArguments !== undefined ? "arguments" : "input",
    outBadge: n.status.code === "error" ? "error" : n.content?.outputMessages !== undefined ? "response" : n.content?.toolResult !== undefined ? "result" : "output",
    stats: [stat("Duration", formatDuration(n.durationMs)), stat("Tokens", tokens ? formatCount(tokens) : null)].filter(
      (s): s is { k: string; v: string } => s !== null,
    ),
    modelChip: g?.responseModel ?? g?.requestModel ?? g?.toolName ?? null,
    providerChip: g?.provider ?? null,
    attrs: Object.entries(n.attributes),
    events: n.events.map((e) => ({ ...e, offset: Date.parse(e.time) - Date.parse(n.startTime) })),
    meta: [
      ...genAiRows(n),
      ...parseMetadataRows(n.attributes["memtrace.metadata"]),
      ...metaTags,
      ["Service", n.serviceName],
      ["Start time", formatDateTime(n.startTime)],
      ["Offset", `+${formatDuration(n.offsetMs)}`],
      ["Span ID", n.spanId],
      ["Parent", n.parentSpanId ?? "–"],
    ] as [string, string | number][],
  };
});

type Tab = "attrs" | "events" | "meta";
const tab = ref<Tab>("attrs");
const tabs = computed(() => [
  { key: "attrs" as const, label: "Attributes", count: cur.value.attrs.length },
  { key: "events" as const, label: "Events", count: cur.value.events.length },
  { key: "meta" as const, label: "Metadata", count: cur.value.meta.length },
]);
</script>

<template>
  <section class="inspector mt-card" aria-label="Selected span details">
    <div class="head">
      <span class="kind-box" :style="{ background: cur.kind.bg }"><q-icon :name="cur.kind.icon" :style="{ color: cur.kind.color }" size="16px" /></span>
      <div class="title">
        <div class="name-row">
          <span class="mono name" :title="node.name">{{ node.name }}</span>
          <span v-if="cur.modelChip" class="chip mono">{{ cur.modelChip }}</span>
          <span v-if="cur.providerChip" class="chip mono muted-chip">{{ cur.providerChip }}</span>
        </div>
        <span class="muted">
          {{ cur.kind.label }} · start +{{ formatDuration(node.offsetMs) }} ·
          <span class="st" :class="node.status.code">{{ node.status.code === "ok" ? "OK" : node.status.code === "error" ? "Error" : "No status" }}</span>
        </span>
      </div>
      <div class="stats">
        <div v-for="s in cur.stats" :key="s.k" class="stat"><span class="muted k">{{ s.k }}</span><span class="mono v">{{ s.v }}</span></div>
      </div>
    </div>

    <div class="body">
      <div class="slot"><IoPanel title="Input" :badge="cur.inBadge" :blocks="cur.io.input" :json="cur.io.inputJson" :empty-hint="emptyHint" /></div>
      <div class="slot"><IoPanel title="Output" :badge="cur.outBadge" :badge-tone="node.status.code === 'error' ? 'error' : 'neutral'" :blocks="cur.output" :json="cur.io.outputJson" :empty-hint="emptyHint" /></div>

      <section class="tabs" aria-label="Span metadata">
        <div class="mt-segmented" role="tablist">
          <button v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-pressed="tab === t.key" :aria-selected="tab === t.key" @click="tab = t.key">
            {{ t.label }}<span class="mono count">{{ t.count }}</span>
          </button>
        </div>
        <div v-if="tab === 'attrs'" class="kv">
          <div v-for="[k, v] in cur.attrs" :key="k" class="kv-row"><span class="k" :title="k">{{ k }}</span><span class="val" :title="v">{{ v }}</span></div>
          <p v-if="cur.attrs.length === 0" class="muted empty">No additional attributes.</p>
        </div>
        <div v-else-if="tab === 'events'" class="events">
          <div v-for="(e, i) in cur.events" :key="i" class="ev">
            <span class="muted">+{{ formatDuration(Math.max(0, e.offset)) }}</span>
            <span class="ev-name" :class="{ err: e.name === 'exception' }">{{ e.name }}</span>
            <span class="val" :title="JSON.stringify(e.attributes)">{{ Object.entries(e.attributes).map(([k, v]) => `${k}=${v}`).join(" · ") }}</span>
          </div>
          <p v-if="cur.events.length === 0" class="muted empty">This span recorded no events.</p>
        </div>
        <div v-else class="kv">
          <div v-for="[k, v] in cur.meta" :key="k" class="kv-row"><span class="k">{{ k }}</span><span class="val">{{ v }}</span></div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.inspector {
  box-sizing: border-box;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 0;
  min-height: 0;
  /* Panel sólido: sin sombra, el borde marca los límites */
  box-shadow: none;
  border: 1px solid var(--mt-line);
}
.muted {
  color: var(--mt-muted);
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
  flex-shrink: 0;
}
.kind-box {
  width: 30px;
  height: 30px;
  border-radius: var(--mt-radius-sm);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.title {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.name {
  font-size: 15px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  color: var(--mt-ink);
  font-size: 11px;
}
.chip.muted-chip {
  background: transparent;
  border: 1px solid var(--mt-line);
  color: var(--mt-muted);
}
.st {
  font-weight: 600;
}
.st.ok {
  color: var(--mt-ok-ink);
}
.st.error {
  color: var(--mt-err-ink);
}
.stats {
  display: flex;
  gap: 22px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.stat .k {
  font-size: 11px;
}
.stat .v {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
/* input arriba, output abajo, metadata al final; la columna hace scroll si no cabe */
/* Un único scroll para todo el lateral: Input, Output y las pestañas fluyen en la misma columna
   en vez de cada uno con su propio scroll interno (si no, scrollear Input no mueve Output). */
.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.slot {
  display: flex;
  flex-shrink: 0;
}
.slot > :deep(*) {
  flex: 1;
}
.tabs {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
  flex-shrink: 0;
}
.tabs .mt-segmented {
  align-self: flex-start;
}
.count {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-line);
  color: var(--mt-muted);
}
.kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 20px;
  font-family: var(--mt-mono);
  font-size: 11.5px;
}
.kv-row {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--mt-line-2);
}
.kv .k {
  color: var(--mt-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.val {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.events {
  display: flex;
  flex-direction: column;
  font-family: var(--mt-mono);
  font-size: 11.5px;
}
.ev {
  display: grid;
  grid-template-columns: 76px 190px minmax(0, 1fr);
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--mt-line-2);
}
.ev-name {
  font-weight: 500;
}
.ev-name.err {
  color: var(--mt-err-ink);
}
.empty {
  margin: 0;
  font-size: 13px;
  font-family: var(--mt-sans);
}
@media (max-width: 1100px) {
  .kv {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
