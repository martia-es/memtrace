<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { withGaps } from "@/domain/conversation";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import ErrorBanner from "../components/ErrorBanner.vue";
import TraceTable from "../components/TraceTable.vue";
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

// ---- conversación y trazas (cronológicas: una nueva llega al final, así que al refrescar se vuelve a pedir el tramo cargado + margen) ----
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
const labels = computed(() => new Map((transcript.data.value?.turns ?? []).map((t) => [t.traceId, t.user?.replace(/\s+/g, " ").slice(0, 120)])));

const traces = computed(() => withGaps([...(detail.data.value?.turns.items ?? []), ...extra.value]).map((t) => t.trace));

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
    turnsLimit.value = Math.min(MAX_PAGE, Math.max(PAGE, traces.value.length + 20));
    await Promise.all([load(), transcript.run()]);
  },
  { isBusy: () => detail.loading.value || more.loading.value || transcript.loading.value },
);

// ---- cabecera ----
const conversation = computed(() => detail.data.value);
const stats = computed(() => {
  const c = conversation.value;
  if (!c) return [];
  return [
    { k: "Trazas", v: formatCount(c.turnCount) },
    { k: "Tiempo activo", v: formatDuration(c.activeMs) },
    { k: "Tokens", v: c.totalTokens ? formatCount(c.totalTokens) : "–" },
    { k: "Spans fallidos", v: formatCount(c.failedSpans) },
  ];
});

const openTrace = (traceId: string) => void router.push({ name: "trace", params: { traceId }, query: f.shared.value });
const backToList = () => void router.push({ name: "conversations", query: { ...f.shared.value, group: "conversation" } });
</script>

<template>
  <div class="page">
    <nav class="crumbs" aria-label="Ruta">
      <button type="button" class="crumb" @click="backToList">Conversaciones</button>
      <q-icon name="chevron_right" size="16px" />
      <span class="mono current">{{ conversationId }}</span>
    </nav>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="load" />
    <div v-else-if="!conversation" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-if="conversation">
      <header class="head mt-card">
        <div class="titles">
          <div class="title-row">
            <h1>Conversación</h1>
            <span v-if="conversation.errorTurns" class="mt-pill error">{{ conversation.errorTurns }} {{ conversation.errorTurns === 1 ? "traza con error" : "trazas con error" }}</span>
            <span v-else-if="conversation.failedSpans" class="mt-pill warn">{{ conversation.failedSpans }} {{ conversation.failedSpans === 1 ? "span con fallos" : "spans con fallos" }}</span>
          </div>
          <span class="muted sub"><span class="mono id">{{ conversationId }}</span> · {{ conversation.serviceNames.join(", ") }} · {{ formatDateTime(conversation.startTime) }}</span>
        </div>
        <div class="stats">
          <div v-for="s in stats" :key="s.k" class="stat"><span class="muted k">{{ s.k }}</span><span class="v">{{ s.v }}</span></div>
        </div>
      </header>

      <section class="mt-card list" aria-label="Trazas de la conversación">
        <TraceTable v-if="traces.length" :items="traces" :labels="labels" @open="openTrace" />
        <p v-else class="muted empty">Esta conversación no tiene trazas que mostrar.</p>
        <button v-if="cursor" type="button" class="more" :disabled="more.loading.value" @click="loadMore">{{ more.loading.value ? "Cargando…" : "Cargar más trazas" }}</button>
        <ErrorBanner v-if="more.error.value" :error="more.error.value" @retry="loadMore" />
      </section>
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
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--mt-muted);
  font-size: 13px;
  flex-shrink: 0;
}
.crumb {
  border: 0;
  background: none;
  padding: 0;
  color: var(--mt-violet);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.current {
  color: var(--mt-ink);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.muted {
  color: var(--mt-muted);
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
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
.list {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
}
.empty {
  margin: 0;
  padding: 20px;
}
.more {
  display: block;
  margin: 10px auto 0;
  height: 30px;
  padding: 0 14px;
  border: 1px solid #e3eae5;
  border-radius: 15px;
  background: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
@media (max-width: 1100px) {
  .stats {
    display: none;
  }
}
</style>
