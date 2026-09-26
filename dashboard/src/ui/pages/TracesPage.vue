<script setup lang="ts">
import type { TraceSummaryDto } from "@contract";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { ListTracesParams } from "@/application/trace-api";
import { formatCount, formatDateTime, formatDuration, formatRelativeTime } from "@/domain/format";
import { mergeLatestTraces } from "@/domain/merge";
import { resolveRange } from "@/domain/time-range";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useAsync } from "../composables/useAsync";
import { usePagedList } from "../composables/usePagedList";
import { setRefreshSeconds, useLiveRefresh } from "../composables/useLiveRefresh";
import { useFilters } from "../composables/useFilters";
import { useTraceApi } from "../composables/useTraceApi";

const PAGE_SIZE = 50;
const api = useTraceApi();
const router = useRouter();
const f = useFilters();
const now = ref(Date.now());

const params = (cursor?: string): ListTracesParams => ({
  ...resolveRange(f.range.value, Date.now()),
  service: f.service.value,
  status: f.status.value,
  hasErrors: f.hasErrors.value || undefined,
  minDurationMs: f.minDurationMs.value,
  conversationId: f.conversationId.value,
  limit: PAGE_SIZE,
  cursor,
});

const list = usePagedList<TraceSummaryDto>({
  key: (t) => t.traceId,
  load: (cursor, signal) => api.listTraces(params(cursor), signal),
  merge: mergeLatestTraces,
  onLoaded: () => {
    liveRefresh.touch();
    now.value = Date.now();
  },
});
const items = list.items;
const nextCursor = list.nextCursor;
const services = useAsync((signal) => api.listServices(resolveRange(f.range.value, Date.now()), signal));

const liveRefresh = useLiveRefresh(() => list.refresh(), { isBusy: () => list.loading.value || list.moreLoading.value });

const reload = () => {
  void list.reload();
  void services.run();
};
watch([f.range, f.service, f.status, f.hasErrors, f.minDurationMs, f.conversationId], reload, { immediate: true });

const maxDuration = computed(() => Math.max(1, ...items.value.map((t) => t.durationMs)));
const filtered = computed(() => Boolean(f.service.value || f.status.value || f.hasErrors.value || f.minDurationMs.value || f.conversationId.value));

const columns = [
  { name: "status", label: "", field: "status", align: "left" as const, style: "width: 90px" },
  { name: "name", label: "Traza", field: "rootSpanName", align: "left" as const },
  { name: "start", label: "Inicio", field: "startTime", align: "left" as const },
  { name: "duration", label: "Duración", field: "durationMs", align: "left" as const, style: "width: 220px" },
  { name: "spans", label: "Spans", field: "spanCount", align: "right" as const },
  { name: "tokens", label: "Tokens", field: "totalTokens", align: "right" as const },
];

const statusOptions = [
  { label: "Todas", value: undefined },
  { label: "Correctas", value: "ok" as const },
  { label: "Con error", value: "error" as const },
];

const open = (_evt: Event, row: TraceSummaryDto) => void router.push({ name: "trace", params: { traceId: row.traceId }, query: f.shared.value });
</script>

<template>
  <q-page padding class="page">
    <div class="text-h6 q-mb-sm">Trazas</div>

    <FilterBar
      :range="f.range.value"
      :service="f.service.value"
      :services="services.data.value?.items ?? []"
      :loading="list.loading.value"
      @update:range="f.setRange"
      @update:service="f.setService"
      @refresh="reload"
    >
      <q-btn-toggle
        :model-value="f.status.value"
        :options="statusOptions"
        dense
        no-caps
        unelevated
        toggle-color="primary"
        class="toggle-group"
        aria-label="Estado de la traza"
        @update:model-value="f.setStatus"
      />
      <q-checkbox :model-value="f.hasErrors.value" dense label="Con spans fallidos" @update:model-value="f.setHasErrors" />
      <q-input
        :model-value="f.minDurationMs.value ?? ''"
        type="number"
        dense
        outlined
        label="Duración mín. (ms)"
        style="width: 160px"
        debounce="400"
        @update:model-value="(v) => f.setMinDuration(Number(v) || undefined)"
      />
    </FilterBar>
    <LiveControl class="q-mt-sm" :seconds="liveRefresh.seconds.value" :updated-at="liveRefresh.updatedAt.value" @update:seconds="setRefreshSeconds" />

    <div v-if="f.conversationId.value" class="q-mt-sm">
      <q-chip removable icon="forum" color="primary" text-color="white" @remove="f.setConversation(undefined)">
        Conversación: {{ f.conversationId.value }}
      </q-chip>
    </div>

    <ErrorBanner v-if="list.error.value" class="q-mt-md" :error="list.error.value" @retry="reload" />

    <q-table
      class="q-mt-md"
      flat
      bordered
      :rows="items"
      :columns="columns"
      row-key="traceId"
      :rows-per-page-options="[0]"
      hide-pagination
      :table-row-class-fn="(row: TraceSummaryDto) => (list.newKeys.value.has(row.traceId) ? 'row-new' : '')"
      :loading="list.loading.value && items.length === 0"
      no-data-label=""
      @row-click="open"
    >
      <template #body-cell-status="{ row }">
        <q-td><StatusBadge :status="row.status" :error-count="row.errorCount" /></q-td>
      </template>
      <template #body-cell-name="{ row }">
        <q-td>
          <div class="text-weight-medium">{{ row.rootSpanName }}</div>
          <div class="text-caption text-grey-7">
            {{ row.serviceName }}
            <router-link
              v-if="row.conversationId"
              class="conv-link"
              :to="{ name: 'conversation', params: { conversationId: row.conversationId }, query: f.shared.value }"
              @click.stop
            >
              <q-icon name="forum" size="14px" /> {{ row.conversationId }}
            </router-link>
          </div>
        </q-td>
      </template>
      <template #body-cell-start="{ row }">
        <q-td>
          {{ formatRelativeTime(row.startTime, now) }}
          <q-tooltip>{{ formatDateTime(row.startTime) }}</q-tooltip>
        </q-td>
      </template>
      <template #body-cell-duration="{ row }">
        <q-td>
          <div class="row items-center no-wrap q-gutter-x-sm">
            <span class="dur-text">{{ formatDuration(row.durationMs) }}</span>
            <q-linear-progress
              :value="row.durationMs / maxDuration"
              :color="row.status === 'error' ? 'negative' : 'primary'"
              track-color="grey-4"
              size="6px"
              rounded
              class="col"
            />
          </div>
        </q-td>
      </template>
      <template #body-cell-spans="{ row }">
        <q-td class="text-right">{{ formatCount(row.spanCount) }}</q-td>
      </template>
      <template #body-cell-tokens="{ row }">
        <q-td class="text-right">{{ row.totalTokens ? formatCount(row.totalTokens) : "–" }}</q-td>
      </template>
      <template #bottom-row>
        <q-tr v-if="!list.loading.value && items.length === 0 && !list.error.value">
          <q-td colspan="100%">
            <EmptyState icon="timeline" :title="filtered ? 'Ninguna traza coincide con los filtros' : 'Todavía no hay trazas en este rango'">
              <template v-if="!filtered">Ejecuta un agente instrumentado (p. ej. <code>examples/01_raw_agent.py</code>) o amplía el rango.</template>
              <template v-else>Prueba a quitar filtros o ampliar el rango de tiempo.</template>
            </EmptyState>
          </q-td>
        </q-tr>
      </template>
    </q-table>

    <div v-if="nextCursor" class="row justify-center q-mt-md">
      <q-btn outline no-caps color="primary" label="Cargar más" :loading="list.moreLoading.value" @click="list.loadMore" />
    </div>
    <ErrorBanner v-if="list.moreError.value" class="q-mt-md" :error="list.moreError.value" @retry="list.loadMore" />
    <div v-if="items.length > 0" class="text-caption text-grey-7 text-center q-mt-sm">
      {{ items.length }} {{ items.length === 1 ? "traza" : "trazas" }}{{ nextCursor ? " · hay más" : "" }}
    </div>
  </q-page>
</template>

<style scoped>
.page {
  max-width: 1300px;
  margin: 0 auto;
}
.conv-link {
  margin-left: 8px;
  color: var(--q-primary);
  text-decoration: none;
}
.conv-link:hover {
  text-decoration: underline;
}
.dur-text {
  min-width: 64px;
}
/* aparición de trazas nuevas: fundido del resaltado */
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
:deep(tbody tr) {
  cursor: pointer;
}
</style>
