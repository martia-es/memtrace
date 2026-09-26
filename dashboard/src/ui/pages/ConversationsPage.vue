<script setup lang="ts">
import type { ConversationSummaryDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { formatCount, formatDateTime, formatDuration, formatRelativeTime } from "@/domain/format";
import { mergeLatestConversations } from "@/domain/merge";
import { resolveRange } from "@/domain/time-range";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { setRefreshSeconds, useLiveRefresh } from "../composables/useLiveRefresh";
import { usePagedList } from "../composables/usePagedList";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 50;
const api = useTraceApi();
const router = useRouter();
const f = useFilters();
const now = ref(Date.now());

const list = usePagedList<ConversationSummaryDto>({
  key: (c) => c.conversationId,
  load: (cursor, signal) =>
    api.listConversations(
      { ...resolveRange(f.range.value, Date.now()), service: f.service.value, hasErrors: f.hasErrors.value || undefined, limit: PAGE_SIZE, cursor },
      signal,
    ),
  merge: mergeLatestConversations,
  onLoaded: () => {
    liveRefresh.touch();
    now.value = Date.now();
  },
});
const items = list.items;
const services = useAsync((signal) => api.listServices(resolveRange(f.range.value, Date.now()), signal));
const liveRefresh = useLiveRefresh(() => list.refresh(), { isBusy: () => list.loading.value || list.moreLoading.value });

const reload = () => {
  void list.reload();
  void services.run();
};
watch([f.range, f.service, f.hasErrors], reload, { immediate: true });

const filtered = computed(() => Boolean(f.service.value || f.hasErrors.value));

const columns = [
  { name: "conversation", label: "Conversación", field: "conversationId", align: "left" as const },
  { name: "turns", label: "Turnos", field: "turnCount", align: "right" as const },
  { name: "activity", label: "Última actividad", field: "lastActivity", align: "left" as const },
  { name: "active", label: "Tiempo activo", field: "activeMs", align: "right" as const },
  { name: "tokens", label: "Tokens", field: "totalTokens", align: "right" as const },
  { name: "errors", label: "Errores", field: "errorTurns", align: "left" as const },
];

const open = (_evt: Event, row: ConversationSummaryDto) =>
  void router.push({ name: "conversation", params: { conversationId: row.conversationId }, query: f.shared.value });
</script>

<template>
  <q-page padding class="page">
    <div class="text-h6 q-mb-sm">Conversaciones</div>

    <FilterBar
      :range="f.range.value"
      :service="f.service.value"
      :services="services.data.value?.items ?? []"
      :loading="list.loading.value"
      @update:range="f.setRange"
      @update:service="f.setService"
      @refresh="reload"
    >
      <q-checkbox :model-value="f.hasErrors.value" dense label="Con spans fallidos" @update:model-value="f.setHasErrors" />
    </FilterBar>
    <LiveControl class="q-mt-sm" :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />

    <ErrorBanner v-if="list.error.value" class="q-mt-md" :error="list.error.value" @retry="reload" />

    <q-table
      class="q-mt-md"
      flat
      bordered
      :rows="items"
      :columns="columns"
      row-key="conversationId"
      :rows-per-page-options="[0]"
      hide-pagination
      :table-row-class-fn="(row: ConversationSummaryDto) => (list.newKeys.value.has(row.conversationId) ? 'row-new' : '')"
      :loading="list.loading.value && items.length === 0"
      no-data-label=""
      @row-click="open"
    >
      <template #body-cell-conversation="{ row }">
        <q-td>
          <div class="text-weight-medium"><q-icon name="forum" size="16px" class="q-mr-xs" />{{ row.conversationId }}</div>
          <div class="text-caption text-grey-7">{{ row.serviceNames.join(", ") }}</div>
        </q-td>
      </template>
      <template #body-cell-turns="{ row }">
        <q-td class="text-right">{{ formatCount(row.turnCount) }}</q-td>
      </template>
      <template #body-cell-activity="{ row }">
        <q-td>
          {{ formatRelativeTime(row.lastActivity, now) }}
          <q-tooltip>{{ formatDateTime(row.lastActivity) }} · iniciada {{ formatDateTime(row.startTime) }}</q-tooltip>
        </q-td>
      </template>
      <template #body-cell-active="{ row }">
        <q-td class="text-right">{{ formatDuration(row.activeMs) }}</q-td>
      </template>
      <template #body-cell-tokens="{ row }">
        <q-td class="text-right">{{ row.totalTokens ? formatCount(row.totalTokens) : "–" }}</q-td>
      </template>
      <template #body-cell-errors="{ row }">
        <q-td>
          <q-badge v-if="row.errorTurns > 0" color="negative" :label="`${row.errorTurns} ${row.errorTurns === 1 ? 'turno fallido' : 'turnos fallidos'}`" />
          <q-badge v-else-if="row.failedSpans > 0" color="warning" text-color="black" :label="`${row.failedSpans} ${row.failedSpans === 1 ? 'span fallido' : 'spans fallidos'}`">
            <q-tooltip>Algún span falló dentro de un turno que terminó bien</q-tooltip>
          </q-badge>
          <span v-else class="text-grey-6">–</span>
        </q-td>
      </template>
      <template #bottom-row>
        <q-tr v-if="!list.loading.value && items.length === 0 && !list.error.value">
          <q-td colspan="100%">
            <EmptyState icon="forum" :title="filtered ? 'Ninguna conversación coincide con los filtros' : 'Todavía no hay conversaciones en este rango'">
              <template v-if="filtered">Prueba a quitar filtros o ampliar el rango de tiempo. </template>
              Una conversación agrupa las trazas que comparten <code>gen_ai.conversation.id</code>: envuelve tu agente con
              <code>memtrace.session("id")</code> (o usa <code>thread_id</code> en LangChain).
            </EmptyState>
          </q-td>
        </q-tr>
      </template>
    </q-table>

    <div v-if="list.nextCursor.value" class="row justify-center q-mt-md">
      <q-btn outline no-caps color="primary" label="Cargar más" :loading="list.moreLoading.value" @click="list.loadMore" />
    </div>
    <ErrorBanner v-if="list.moreError.value" class="q-mt-md" :error="list.moreError.value" @retry="list.loadMore" />
    <div v-if="items.length > 0" class="text-caption text-grey-7 text-center q-mt-sm">
      {{ items.length }} {{ items.length === 1 ? "conversación" : "conversaciones" }}{{ list.nextCursor.value ? " · hay más" : "" }}
    </div>
  </q-page>
</template>

<style scoped>
.page {
  max-width: 1300px;
  margin: 0 auto;
}
:deep(tbody tr) {
  cursor: pointer;
}
:deep(tr.row-new) {
  animation: fade-new 3s ease-out;
}
@keyframes fade-new {
  from { background: rgba(33, 186, 69, 0.28); }
  to { background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  :deep(tr.row-new) { animation: none; background: rgba(33, 186, 69, 0.14); }
}
</style>
