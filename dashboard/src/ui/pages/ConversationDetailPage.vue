<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { withGaps } from "@/domain/conversation";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import { kindMeta } from "@/domain/meta";
import { genAiRows, spanIo, type IoBlock } from "@/domain/span-io";
import { findNode, firstErrorNode } from "@/domain/waterfall";
import ErrorBanner from "../components/ErrorBanner.vue";
import IoPanel from "../components/IoPanel.vue";
import SpanTree from "../components/SpanTree.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useLiveRefresh } from "../composables/useLiveRefresh";
import { useTraceApi } from "../composables/useTraceApi";

const props = defineProps<{ conversationId: string }>();
const api = useTraceApi();
const router = useRouter();
const route = useRoute();
const f = useFilters();

const PAGE = 100;
const MAX_PAGE = 200;
const turnsLimit = ref(PAGE);

// ---- conversación y turnos (cronológicos: uno nuevo llega al final, así que al refrescar se vuelve a pedir el tramo cargado + margen) ----
const detail = useAsync((signal) => api.getConversation(props.conversationId, { limit: turnsLimit.value }, signal));
const more = useAsync((signal) => api.getConversation(props.conversationId, { limit: PAGE, cursor: cursor.value ?? undefined }, signal));
const extra = ref<NonNullable<typeof detail.data.value>["turns"]["items"]>([]);
const cursor = ref<string | null>(null);

async function load() {
  const result = await detail.run();
  if (!result) return;
  extra.value = [];
  cursor.value = result.turns.nextCursor;
  liveRefresh.touch();
}
async function loadMore() {
  const result = await more.run();
  if (!result) return;
  extra.value = [...extra.value, ...result.turns.items];
  cursor.value = result.turns.nextCursor;
}

// El texto de cada turno sale de la transcripción (solo existe si el agente capturó contenido, ADR-013)
const transcript = useAsync((signal) => api.getTranscript(props.conversationId, signal));
const userText = computed(() => new Map((transcript.data.value?.turns ?? []).map((t) => [t.traceId, t.user])));

const turns = computed(() => withGaps([...(detail.data.value?.turns.items ?? []), ...extra.value]));

// ---- selección: turno y span en la URL (?turn=&span=) para poder compartir el enlace ----
const queryString = (key: string) => (typeof route.query[key] === "string" ? (route.query[key] as string) : undefined);
const selectedTurn = computed(() => {
  const wanted = queryString("turn");
  return turns.value.find((t) => t.trace.traceId === wanted) ?? turns.value.find((t) => t.trace.status === "error") ?? turns.value[0] ?? null;
});
const selectedTraceId = computed(() => selectedTurn.value?.trace.traceId ?? null);

const trace = useAsync((signal) => api.getTrace(selectedTraceId.value!, signal));
const roots = computed(() => trace.data.value?.roots ?? []);
const selectedNode = computed(() => {
  const wanted = queryString("span");
  return (wanted ? findNode(roots.value, wanted) : null) ?? firstErrorNode(roots.value) ?? roots.value[0] ?? null;
});

const selectTurn = (traceId: string) => void router.replace({ query: { ...route.query, turn: traceId, span: undefined } });
const selectSpan = (spanId: string) => void router.replace({ query: { ...route.query, span: spanId } });

watch(selectedTraceId, (id) => id && void trace.run(), { immediate: true });
watch(
  () => props.conversationId,
  () => {
    turnsLimit.value = PAGE;
    void load();
    void transcript.run();
  },
  { immediate: true },
);

const liveRefresh = useLiveRefresh(
  async () => {
    turnsLimit.value = Math.min(MAX_PAGE, Math.max(PAGE, turns.value.length + 20));
    await Promise.all([load(), transcript.run(), selectedTraceId.value ? trace.run() : null]);
  },
  { isBusy: () => detail.loading.value || more.loading.value || transcript.loading.value || trace.loading.value },
);

// ---- cabecera ----
const conversation = computed(() => detail.data.value);
const title = computed(() => {
  const first = turns.value.map((t) => userText.value.get(t.trace.traceId)).find(Boolean);
  return first ? first.replace(/\s+/g, " ").slice(0, 90) : props.conversationId;
});
const stats = computed(() => {
  const c = conversation.value;
  if (!c) return [];
  return [
    { k: "Turnos", v: formatCount(c.turnCount) },
    { k: "Tiempo activo", v: formatDuration(c.activeMs) },
    { k: "Tokens", v: c.totalTokens ? formatCount(c.totalTokens) : "–" },
    { k: "Spans fallidos", v: formatCount(c.failedSpans) },
  ];
});
const turnStatus = (t: { status: string; errorCount: number }) => (t.status === "error" ? "error" : t.errorCount > 0 ? "warn" : "ok");
const TURN_LABEL = { ok: "OK", error: "Error", warn: "Con fallos" } as const;

// ---- span seleccionado ----
const cur = computed(() => {
  const n = selectedNode.value;
  if (!n) return null;
  const io = spanIo(n);
  const chat = n.content?.inputMessages !== undefined;
  const output: IoBlock[] = n.status.code === "error" ? [{ label: "error", text: n.status.message || "El span terminó con error", structured: false, role: "error" }, ...io.output] : io.output;
  const g = n.genAi;
  const stat = (k: string, v: string | null) => (v ? { k, v } : null);
  return {
    node: n,
    kind: kindMeta(n.kind),
    io,
    output,
    inBadge: chat ? `${io.input.length} ${io.input.length === 1 ? "mensaje" : "mensajes"}` : n.content?.toolArguments !== undefined ? "argumentos" : "entrada",
    outBadge: n.status.code === "error" ? "error" : n.content?.outputMessages !== undefined ? "respuesta" : n.content?.toolResult !== undefined ? "resultado" : "salida",
    stats: [
      stat("Duración", formatDuration(n.durationMs)),
      stat("Tokens", g && (g.totalTokens ?? (g.inputTokens ?? 0) + (g.outputTokens ?? 0)) ? `${formatCount(g.totalTokens ?? (g.inputTokens ?? 0) + (g.outputTokens ?? 0))}` : null),
      stat("Modelo", g?.responseModel ?? g?.requestModel ?? null),
      stat("Proveedor", g?.provider ?? g?.toolName ?? null),
    ].filter((s): s is { k: string; v: string } => s !== null),
    attrs: Object.entries(n.attributes),
    events: n.events.map((e) => ({ ...e, offset: Date.parse(e.time) - Date.parse(n.startTime) })),
    meta: [
      ...genAiRows(n),
      ["Servicio", n.serviceName],
      ["Inicio", formatDateTime(n.startTime)],
      ["Desfase", `+${formatDuration(n.offsetMs)}`],
      ["Span id", n.spanId],
      ["Padre", n.parentSpanId ?? "–"],
    ] as [string, string | number][],
  };
});

type Tab = "attrs" | "events" | "meta";
const tab = ref<Tab>("attrs");
const tabs = computed(() => [
  { key: "attrs" as const, label: "Atributos", count: cur.value?.attrs.length ?? 0 },
  { key: "events" as const, label: "Eventos", count: cur.value?.events.length ?? 0 },
  { key: "meta" as const, label: "Metadatos", count: cur.value?.meta.length ?? 0 },
]);

const hint = computed(() =>
  transcript.data.value && !transcript.data.value.contentCaptured
    ? "Este span no tiene contenido guardado. Activa MEMTRACE_CAPTURE_CONTENT=true en el agente para verlo aquí (se guarda tal cual: revisa la privacidad)."
    : "Este span no tiene contenido guardado.",
);

const openTrace = () => selectedTraceId.value && void router.push({ name: "trace", params: { traceId: selectedTraceId.value }, query: { ...f.shared.value, span: selectedNode.value?.spanId } });
const back = () => void router.push({ name: "spans", query: f.shared.value });
</script>

<template>
  <div class="page">
    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="load" />
    <div v-else-if="!conversation" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-if="conversation">
      <header class="head mt-card">
        <div class="head-left">
          <button type="button" class="mt-round-btn back" aria-label="Volver a los spans" @click="back">
            <q-icon name="chevron_left" size="22px" />
          </button>
          <div class="titles">
            <div class="title-row">
              <h1 :title="title">{{ title }}</h1>
              <span v-if="conversation.errorTurns" class="mt-pill error">{{ conversation.errorTurns }} {{ conversation.errorTurns === 1 ? "turno con error" : "turnos con error" }}</span>
              <span v-else-if="conversation.failedSpans" class="mt-pill warn">{{ conversation.failedSpans }} {{ conversation.failedSpans === 1 ? "span con fallos" : "spans con fallos" }}</span>
            </div>
            <span class="muted sub"><span class="mono id">{{ conversationId }}</span> · {{ conversation.serviceNames.join(", ") }} · {{ formatDateTime(conversation.startTime) }}</span>
          </div>
        </div>
        <div class="stats">
          <div v-for="s in stats" :key="s.k" class="stat"><span class="muted k">{{ s.k }}</span><span class="v">{{ s.v }}</span></div>
        </div>
      </header>

      <div class="cols">
        <div class="left">
          <section class="mt-card turns" aria-label="Turnos">
            <h2>Turnos</h2>
            <div class="turn-list">
              <button
                v-for="t in turns"
                :key="t.trace.traceId"
                type="button"
                class="turn"
                :class="{ selected: t.trace.traceId === selectedTraceId }"
                :aria-pressed="t.trace.traceId === selectedTraceId"
                @click="selectTurn(t.trace.traceId)"
              >
                <span class="num" :class="turnStatus(t.trace)">{{ t.index }}</span>
                <span class="text" :class="{ w: t.trace.traceId === selectedTraceId }">{{ userText.get(t.trace.traceId) ?? t.trace.rootSpanName }}</span>
                <span class="mt-pill small" :class="turnStatus(t.trace)">{{ TURN_LABEL[turnStatus(t.trace)] }}</span>
                <span class="mono dur muted">{{ formatDuration(t.trace.durationMs) }}</span>
              </button>
            </div>
            <button v-if="cursor" type="button" class="more" :disabled="more.loading.value" @click="loadMore">{{ more.loading.value ? "Cargando…" : "Cargar más turnos" }}</button>
            <ErrorBanner v-if="more.error.value" :error="more.error.value" @retry="loadMore" />
          </section>

          <section class="mt-card tree-card" aria-label="Árbol de spans">
            <div class="tree-head">
              <h2>Árbol de spans</h2>
              <span class="mono muted meta">{{ trace.data.value ? `${trace.data.value.spanCount} spans · ${formatDuration(trace.data.value.durationMs)}` : "" }}</span>
            </div>
            <ErrorBanner v-if="trace.error.value" :error="trace.error.value" @retry="trace.run()" />
            <div v-else-if="!trace.data.value" class="loading small"><q-spinner size="24px" color="primary" /></div>
            <SpanTree v-else :roots="roots" :total-ms="trace.data.value.durationMs" :selected-id="selectedNode?.spanId ?? null" @select="selectSpan" />
          </section>
        </div>

        <div v-if="cur" class="right">
          <section class="mt-card cur">
            <span class="kind-box" :style="{ background: cur.kind.bg }"><span class="kind-dot" :style="{ background: cur.kind.color }" /></span>
            <div class="cur-title">
              <span class="mono name" :title="cur.node.name">{{ cur.node.name }}</span>
              <span class="muted">
                {{ cur.kind.label }} · inicio +{{ formatDuration(cur.node.offsetMs) }} ·
                <span class="st" :class="cur.node.status.code">{{ cur.node.status.code === "ok" ? "OK" : cur.node.status.code === "error" ? "Error" : "Sin estado" }}</span>
              </span>
            </div>
            <div class="cur-stats">
              <div v-for="s in cur.stats" :key="s.k" class="cstat"><span class="muted k">{{ s.k }}</span><span class="mono v">{{ s.v }}</span></div>
            </div>
            <button type="button" class="link-btn" title="Abrir la traza completa" @click="openTrace">Ver traza</button>
          </section>

          <div class="io">
            <IoPanel title="Input" :badge="cur.inBadge" :blocks="cur.io.input" :json="cur.io.inputJson" :empty-hint="hint" />
            <IoPanel title="Output" :badge="cur.outBadge" :badge-tone="cur.node.status.code === 'error' ? 'error' : 'neutral'" :blocks="cur.output" :json="cur.io.outputJson" :empty-hint="hint" />
          </div>

          <section class="mt-card detail-tabs" aria-label="Detalles del span">
            <div class="mt-segmented" role="tablist">
              <button v-for="t in tabs" :key="t.key" type="button" role="tab" :aria-pressed="tab === t.key" :aria-selected="tab === t.key" @click="tab = t.key">
                {{ t.label }}<span class="mono count">{{ t.count }}</span>
              </button>
            </div>
            <div class="tab-body">
              <div v-if="tab === 'attrs'" class="kv">
                <div v-for="[k, v] in cur.attrs" :key="k" class="kv-row"><span class="k" :title="k">{{ k }}</span><span class="val" :title="v">{{ v }}</span></div>
                <p v-if="cur.attrs.length === 0" class="muted empty">Sin atributos adicionales.</p>
              </div>
              <div v-else-if="tab === 'events'" class="events">
                <div v-for="(e, i) in cur.events" :key="i" class="ev">
                  <span class="muted">+{{ formatDuration(Math.max(0, e.offset)) }}</span>
                  <span class="ev-name" :class="{ err: e.name === 'exception' }">{{ e.name }}</span>
                  <span class="val" :title="JSON.stringify(e.attributes)">{{ Object.entries(e.attributes).map(([k, v]) => `${k}=${v}`).join(" · ") }}</span>
                </div>
                <p v-if="cur.events.length === 0" class="muted empty">Este span no registró eventos.</p>
              </div>
              <div v-else class="kv">
                <div v-for="[k, v] in cur.meta" :key="k" class="kv-row"><span class="k">{{ k }}</span><span class="val">{{ v }}</span></div>
              </div>
            </div>
          </section>
        </div>
        <div v-else class="right"><section class="mt-card empty-card">Esta conversación no tiene turnos que mostrar.</section></div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.loading.small {
  padding: 24px;
}
.muted {
  color: var(--mt-muted);
}
h1,
h2 {
  margin: 0;
}
h2 {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.head {
  box-sizing: border-box;
  padding: 16px 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-shrink: 0;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}
.back {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
}
.titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
h1 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.id {
  color: var(--mt-violet);
  font-size: 12px;
}
.stats {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 16px;
  border-radius: 16px;
  background: var(--mt-soft-2);
}
.stat .k {
  font-size: 11px;
}
.stat .v {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.cols {
  display: grid;
  grid-template-columns: 396px minmax(0, 1fr);
  gap: 16px;
  flex: 1;
  min-height: 0;
}
.left,
.right {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  min-height: 0;
}
.turns {
  box-sizing: border-box;
  padding: 18px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
  max-height: 42%;
}
.turns h2 {
  padding: 0 8px 4px;
}
.turn-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  min-height: 0;
}
.turn {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.turn:hover {
  background: var(--mt-soft-2);
}
.turn.selected {
  background: var(--mt-soft);
}
.num {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  background: #e6deff;
  color: var(--mt-violet);
}
.num.error {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}
.text.w {
  font-weight: 700;
}
.mt-pill.small {
  padding: 1px 8px;
  font-size: 11px;
  flex-shrink: 0;
}
.dur {
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.more {
  align-self: center;
  margin-top: 4px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid #e3eae5;
  border-radius: 15px;
  background: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.tree-card {
  box-sizing: border-box;
  padding: 18px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-height: 200px;
}
.tree-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 8px 6px;
}
.tree-head .meta {
  font-size: 12px;
}
.cur {
  box-sizing: border-box;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}
.kind-box {
  width: 40px;
  height: 40px;
  border-radius: 13px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.kind-dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
}
.cur-title {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.name {
  font-size: 17px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.cur-stats {
  display: flex;
  gap: 22px;
  margin-left: auto;
}
.cstat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cstat .k {
  font-size: 11px;
}
.cstat .v {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.link-btn {
  flex-shrink: 0;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 16px;
  background: var(--mt-soft);
  color: var(--mt-ink);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.io {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  flex: 1;
  min-height: 160px;
}
.detail-tabs {
  box-sizing: border-box;
  padding: 14px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 196px;
  flex-shrink: 0;
}
.detail-tabs .mt-segmented {
  align-self: flex-start;
  flex-shrink: 0;
}
.count {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mt-line);
  color: var(--mt-muted);
}
.tab-body {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
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
.empty-card {
  padding: 30px;
  color: var(--mt-muted);
}
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
  }
  .stats {
    display: none;
  }
}
</style>
