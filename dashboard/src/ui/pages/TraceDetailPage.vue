<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatCount, formatDateTime, formatDuration, shortId } from "@/domain/format";
import { ancestorIds, findNode, parentIds } from "@/domain/waterfall";
import ErrorBanner from "../components/ErrorBanner.vue";
import SpanDetail from "../components/SpanDetail.vue";
import SpanWaterfall from "../components/SpanWaterfall.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useAsync } from "../composables/useAsync";
import { useFilters } from "../composables/useFilters";
import { useLiveRefresh } from "../composables/useLiveRefresh";
import { useTraceApi } from "../composables/useTraceApi";

const props = defineProps<{ traceId: string }>();
const api = useTraceApi();
const route = useRoute();
const router = useRouter();
const f = useFilters();

const trace = useAsync((signal) => api.getTrace(props.traceId, signal));
watch(() => props.traceId, () => void trace.run(), { immediate: true });

// Una traza en curso aún no ha exportado su span raíz (termina el último): sus spans salen como huérfanos.
// Mientras eso ocurra (y sea reciente) se actualiza sola; al llegar el raíz deja de refrescar.
const IN_PROGRESS_WINDOW_MS = 5 * 60_000;
const inProgress = computed(() => {
  const t = trace.data.value;
  return Boolean(t && t.roots.some((r) => r.orphan) && Date.now() - Date.parse(t.startTime) < IN_PROGRESS_WINDOW_MS);
});
useLiveRefresh(() => trace.run(), { active: () => inProgress.value, isBusy: () => trace.loading.value });

const collapsed = ref<Set<string>>(new Set());
const roots = computed(() => trace.data.value?.roots ?? []);

const selectedId = computed<string | null>(() => {
  const fromUrl = typeof route.query.span === "string" ? route.query.span : null;
  if (fromUrl && findNode(roots.value, fromUrl)) return fromUrl;
  return roots.value[0]?.spanId ?? null;
});
const selectedNode = computed(() => (selectedId.value ? findNode(roots.value, selectedId.value) : null));

// Al abrir un enlace a un span interno hay que expandir sus ancestros
watch([selectedId, roots], () => {
  if (!selectedId.value) return;
  const hidden = ancestorIds(roots.value, selectedId.value).filter((id) => collapsed.value.has(id));
  if (hidden.length > 0) collapsed.value = new Set([...collapsed.value].filter((id) => !hidden.includes(id)));
});

const select = (spanId: string) => void router.replace({ query: { ...route.query, span: spanId } });
const toggle = (spanId: string) => {
  const next = new Set(collapsed.value);
  if (!next.delete(spanId)) next.add(spanId);
  collapsed.value = next;
};
const collapseAll = () => (collapsed.value = new Set(parentIds(roots.value)));
const expandAll = () => (collapsed.value = new Set());

const copyId = () => void navigator.clipboard?.writeText(props.traceId);
const back = () => void router.push({ name: "traces", query: f.shared.value });
const hasOrphans = computed(() => trace.data.value?.roots.some((r) => r.orphan) ?? false);
const rootName = computed(() => roots.value.find((r) => !r.orphan)?.name ?? roots.value[0]?.name ?? "Traza");
const conversationId = computed(() => roots.value[0]?.attributes["gen_ai.conversation.id"]);
</script>

<template>
  <q-page padding class="page">
    <div class="row items-center q-gutter-x-sm q-mb-sm">
      <q-btn flat round dense icon="arrow_back" aria-label="Volver al listado" @click="back" />
      <div class="text-h6">{{ trace.data.value ? rootName : "Traza" }}</div>
      <div class="text-caption text-grey-7 mono">{{ shortId(traceId) }}</div>
      <q-btn flat round dense size="sm" icon="content_copy" aria-label="Copiar id de traza" @click="copyId" />
    </div>

    <ErrorBanner v-if="trace.error.value" :error="trace.error.value" @retry="trace.run()" />
    <div v-else-if="trace.loading.value && !trace.data.value" class="row justify-center q-pa-xl"><q-spinner size="32px" color="primary" /></div>

    <template v-if="trace.data.value">
      <div class="row items-center q-gutter-sm q-mb-md">
        <StatusBadge :status="trace.data.value.status" show-label />
        <q-chip dense square icon="schedule" :label="formatDuration(trace.data.value.durationMs)" />
        <q-chip dense square icon="account_tree" :label="`${formatCount(trace.data.value.spanCount)} spans`" />
        <q-chip v-if="trace.data.value.errorCount" dense square color="negative" text-color="white" icon="error" :label="`${trace.data.value.errorCount} con error`" />
        <q-chip v-if="trace.data.value.totalTokens" dense square icon="toll" :label="`${formatCount(trace.data.value.totalTokens)} tokens`" />
        <q-chip v-if="conversationId" dense square icon="forum" :label="conversationId" />
        <span class="text-caption text-grey-7">{{ formatDateTime(trace.data.value.startTime) }}</span>
      </div>

      <q-banner v-if="trace.data.value.truncated" rounded dense class="bg-warning text-black q-mb-md">
        La traza tiene más de 5000 spans: solo se muestran los primeros.
      </q-banner>
      <q-banner v-if="hasOrphans" rounded dense class="bg-warning text-black q-mb-md">
        <template v-if="inProgress">La traza sigue en curso: se actualiza sola hasta que llegue el span raíz.</template>
        <template v-else>Algunos spans no tienen padre en la traza (perdidos o aún no exportados) y se muestran como raíces.</template>
      </q-banner>

      <div class="layout">
        <div class="col-wf">
          <div class="row items-center q-mb-xs">
            <div class="text-subtitle2">Cascada</div>
            <q-space />
            <q-btn flat dense no-caps size="sm" icon="unfold_less" label="Colapsar" @click="collapseAll" />
            <q-btn flat dense no-caps size="sm" icon="unfold_more" label="Expandir" @click="expandAll" />
          </div>
          <SpanWaterfall :roots="roots" :total-ms="trace.data.value.durationMs" :selected-id="selectedId" :collapsed="collapsed" @select="select" @toggle="toggle" />
        </div>
        <q-card v-if="selectedNode" flat bordered class="col-detail">
          <q-card-section><SpanDetail :node="selectedNode" /></q-card-section>
        </q-card>
      </div>
    </template>
  </q-page>
</template>

<style scoped>
.page {
  max-width: 1500px;
  margin: 0 auto;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 440px;
  gap: 16px;
  align-items: start;
}
.col-detail {
  position: sticky;
  top: 66px;
  max-height: calc(100vh - 90px);
  overflow: auto;
}
@media (max-width: 1100px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .col-detail {
    position: static;
    max-height: none;
  }
}
</style>
