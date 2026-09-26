<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { withGaps } from "@/domain/conversation";
import { formatCount, formatDateTime, formatDuration } from "@/domain/format";
import ErrorBanner from "../components/ErrorBanner.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TranscriptView from "../components/TranscriptView.vue";
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

// Turnos cronológicos: un turno nuevo llega al final, así que al refrescar se vuelve a pedir el tramo cargado (+ margen)
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
// Pestaña en la URL (?tab=transcript): enlace compartible. La transcripción se pide al abrirla, no antes.
const tab = computed<"turns" | "transcript">(() => (route.query.tab === "transcript" ? "transcript" : "turns"));
const setTab = (value: "turns" | "transcript") => void router.replace({ query: { ...route.query, tab: value === "turns" ? undefined : value } });
const transcript = useAsync((signal) => api.getTranscript(props.conversationId, signal));

const liveRefresh = useLiveRefresh(async () => {
  if (tab.value === "transcript") {
    await Promise.all([transcript.run(), load()]);
    return;
  }
  turnsLimit.value = Math.min(MAX_PAGE, Math.max(PAGE, turns.value.length + 20));
  await load();
}, { isBusy: () => detail.loading.value || more.loading.value || transcript.loading.value });
watch(tab, (value) => value === "transcript" && void transcript.run(), { immediate: true });

watch(() => props.conversationId, () => {
  turnsLimit.value = PAGE;
  void load();
  if (tab.value === "transcript") void transcript.run();
}, { immediate: true });

const turns = computed(() => withGaps([...(detail.data.value?.turns.items ?? []), ...extra.value]));
const maxDuration = computed(() => Math.max(1, ...turns.value.map((t) => t.trace.durationMs)));

const gapLabel = (gapMs: number | null) => {
  if (gapMs === null) return "";
  return gapMs < 0 ? "en paralelo con el turno anterior" : `${formatDuration(gapMs)} después del turno anterior`;
};
const open = (traceId: string) => void router.push({ name: "trace", params: { traceId }, query: f.shared.value });
const back = () => void router.push({ name: "conversations", query: f.shared.value });
</script>

<template>
  <q-page padding class="page">
    <div class="row items-center q-gutter-x-sm q-mb-sm">
      <q-btn flat round dense icon="arrow_back" aria-label="Volver a las conversaciones" @click="back" />
      <q-icon name="forum" size="24px" />
      <div class="text-h6">{{ conversationId }}</div>
    </div>

    <ErrorBanner v-if="detail.error.value" :error="detail.error.value" @retry="load" />
    <div v-else-if="detail.loading.value && !detail.data.value" class="row justify-center q-pa-xl"><q-spinner size="32px" color="primary" /></div>

    <template v-if="detail.data.value">
      <div class="row items-center q-gutter-sm q-mb-md">
        <q-chip dense square icon="chat" :label="`${formatCount(detail.data.value.turnCount)} ${detail.data.value.turnCount === 1 ? 'turno' : 'turnos'}`" />
        <q-chip dense square icon="schedule" :label="`${formatDuration(detail.data.value.activeMs)} activo`">
          <q-tooltip>Suma de la duración de los turnos, sin las esperas del usuario</q-tooltip>
        </q-chip>
        <q-chip v-if="detail.data.value.totalTokens" dense square icon="toll" :label="`${formatCount(detail.data.value.totalTokens)} tokens`" />
        <q-chip v-if="detail.data.value.errorTurns" dense square color="negative" text-color="white" icon="error" :label="`${detail.data.value.errorTurns} ${detail.data.value.errorTurns === 1 ? 'turno fallido' : 'turnos fallidos'}`" />
        <q-chip v-if="detail.data.value.failedSpans" dense square color="warning" text-color="black" icon="warning" :label="`${detail.data.value.failedSpans} ${detail.data.value.failedSpans === 1 ? 'span fallido' : 'spans fallidos'}`" />
        <q-chip v-for="s in detail.data.value.serviceNames" :key="s" dense square icon="dns" :label="s" />
        <span class="text-caption text-grey-7">{{ formatDateTime(detail.data.value.startTime) }} → {{ formatDateTime(detail.data.value.lastActivity) }}</span>
      </div>

      <q-tabs :model-value="tab" dense no-caps align="left" active-color="primary" indicator-color="primary" @update:model-value="setTab">
        <q-tab name="turns" icon="view_timeline" label="Turnos" />
        <q-tab name="transcript" icon="chat" label="Transcripción" />
      </q-tabs>
      <q-separator />

      <template v-if="tab === 'transcript'">
        <ErrorBanner v-if="transcript.error.value" class="q-mt-md" :error="transcript.error.value" @retry="transcript.run()" />
        <div v-else-if="!transcript.data.value" class="row justify-center q-pa-xl"><q-spinner size="28px" color="primary" /></div>
        <TranscriptView v-else :transcript="transcript.data.value" @open="open" />
      </template>

      <q-timeline v-else color="primary" class="q-mt-md" layout="dense">
        <q-timeline-entry
          v-for="t in turns"
          :key="t.trace.traceId"
          :color="t.trace.status === 'error' ? 'negative' : t.trace.errorCount > 0 ? 'warning' : 'positive'"
          :icon="t.trace.status === 'error' ? 'error' : 'check'"
        >
          <template #title>
            <span class="turn-title" role="link" tabindex="0" @click="open(t.trace.traceId)" @keydown.enter="open(t.trace.traceId)">
              Turno {{ t.index }} · {{ t.trace.rootSpanName }}
            </span>
          </template>
          <template #subtitle>
            {{ formatDateTime(t.trace.startTime) }}<span v-if="t.gapMs !== null"> · {{ gapLabel(t.gapMs) }}</span>
          </template>
          <q-card flat bordered class="turn-card" role="button" tabindex="0" @click="open(t.trace.traceId)" @keydown.enter="open(t.trace.traceId)">
            <q-card-section class="row items-center q-gutter-x-md no-wrap">
              <StatusBadge :status="t.trace.status" :error-count="t.trace.errorCount" />
              <span class="dur">{{ formatDuration(t.trace.durationMs) }}</span>
              <q-linear-progress
                :value="t.trace.durationMs / maxDuration"
                :color="t.trace.status === 'error' ? 'negative' : 'primary'"
                track-color="grey-4"
                size="6px"
                rounded
                class="col"
              />
              <span class="text-caption text-grey-7">{{ formatCount(t.trace.spanCount) }} spans</span>
              <span v-if="t.trace.totalTokens" class="text-caption text-grey-7">{{ formatCount(t.trace.totalTokens) }} tokens</span>
            </q-card-section>
          </q-card>
        </q-timeline-entry>
      </q-timeline>

      <div v-if="cursor && tab === 'turns'" class="row justify-center q-mt-md">
        <q-btn outline no-caps color="primary" label="Cargar más turnos" :loading="more.loading.value" @click="loadMore" />
      </div>
      <ErrorBanner v-if="more.error.value" class="q-mt-md" :error="more.error.value" @retry="loadMore" />
    </template>
  </q-page>
</template>

<style scoped>
.page {
  max-width: 1000px;
  margin: 0 auto;
}
.turn-title {
  cursor: pointer;
}
.turn-title:hover {
  text-decoration: underline;
}
.turn-card {
  cursor: pointer;
}
.turn-card:hover {
  border-color: var(--q-primary);
}
.dur {
  min-width: 64px;
}
</style>
