<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatCount, formatDateTime, formatDuration, shortId } from "@/domain/format";
import { findNode, firstErrorNode } from "@/domain/waterfall";
import ErrorBanner from "../components/ErrorBanner.vue";
import SpanInspector from "../components/SpanInspector.vue";
import SpanTree from "../components/SpanTree.vue";
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

// An in-progress trace hasn't exported its root span yet (finishes last): its spans come out as orphans.
// While this happens (and is recent) it auto-updates; when the root arrives it stops refreshing.
const IN_PROGRESS_WINDOW_MS = 5 * 60_000;
const inProgress = computed(() => {
  const t = trace.data.value;
  return Boolean(t && t.roots.some((r) => r.orphan) && Date.now() - Date.parse(t.startTime) < IN_PROGRESS_WINDOW_MS);
});
useLiveRefresh(() => trace.run(), { active: () => inProgress.value, isBusy: () => trace.loading.value });

const roots = computed(() => trace.data.value?.roots ?? []);
const hasOrphans = computed(() => roots.value.some((r) => r.orphan));
const rootName = computed(() => roots.value.find((r) => !r.orphan)?.name ?? roots.value[0]?.name ?? "Trace");
const conversationId = computed(() => trace.data.value?.conversationId ?? null);

// ---- selected span (?span=): the one from the link, if not the first with error, if not the root ----
const selectedNode = computed(() => {
  const wanted = typeof route.query.span === "string" ? route.query.span : null;
  return (wanted ? findNode(roots.value, wanted) : null) ?? firstErrorNode(roots.value) ?? roots.value[0] ?? null;
});
const select = (spanId: string) => void router.replace({ query: { ...route.query, span: spanId } });

const hint = "This span has no content saved. Enable MEMTRACE_CAPTURE_CONTENT=true on the agent to see it here (it's saved as-is: check privacy).";

const copyId = () => void navigator.clipboard?.writeText(props.traceId);
const goList = () => void router.push({ name: "conversations", query: f.shared.value });
const goConversation = () => conversationId.value && void router.push({ name: "conversation", params: { conversationId: conversationId.value }, query: f.shared.value });
</script>

<template>
  <div class="page">
    <nav v-if="!trace.data.value" class="crumbs plain" aria-label="Breadcrumbs">
      <button type="button" class="crumb" @click="goList">Conversations</button>
      <q-icon name="chevron_right" size="16px" />
      <span class="mono current">{{ shortId(traceId) }}</span>
    </nav>
    <ErrorBanner v-if="trace.error.value" :error="trace.error.value" @retry="trace.run()" />
    <div v-else-if="!trace.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-if="trace.data.value">
      <header class="head mt-card">
      <nav class="crumbs" aria-label="Breadcrumbs">
        <button type="button" class="crumb" @click="goList">Conversations</button>
        <template v-if="conversationId">
          <q-icon name="chevron_right" size="16px" />
          <button type="button" class="crumb mono" @click="goConversation">{{ conversationId }}</button>
        </template>
        <q-icon name="chevron_right" size="16px" />
        <span class="mono current">{{ shortId(traceId) }}</span>
      </nav>
        <h1 class="leading-none" :title="rootName">{{ rootName }}</h1>
        <div class="pills">
          <span class="muted sub">{{ formatDateTime(trace.data.value.startTime) }}</span>
          <StatusBadge :status="trace.data.value.status" show-label />
          <span class="mt-pill unset"><q-icon name="schedule" size="15px" /> {{ formatDuration(trace.data.value.durationMs) }}</span>
          <span class="mt-pill unset"><q-icon name="account_tree" size="15px" /> {{ `${formatCount(trace.data.value.spanCount)} spans` }}</span>
          <span v-if="trace.data.value.errorCount" class="mt-pill error"><q-icon name="error" size="15px" /> {{ `${trace.data.value.errorCount} with error` }}</span>
          <span v-if="trace.data.value.totalTokens" class="mt-pill unset"><q-icon name="toll" size="15px" /> {{ `${formatCount(trace.data.value.totalTokens)} tokens` }}</span>
          <button type="button" class="mt-round-btn" aria-label="Copy trace ID" @click="copyId"><q-icon name="content_copy" size="18px" /></button>
        </div>
      </header>

      <div v-if="trace.data.value.truncated" class="banner warn">Trace has more than 5000 spans: only showing the first ones.</div>
      <div v-if="hasOrphans" class="banner warn">
        <template v-if="inProgress">The trace is still in progress: auto-updating until the root span arrives.</template>
        <template v-else>Some spans have no parent in the trace (lost or not yet exported) and are shown as roots.</template>
      </div>

      <div class="cols">
        <section class="mt-card tree-card" aria-label="Span tree">
          <div class="tree-head">
            <h2>Spans</h2>
            <span class="mono muted meta">{{ formatDuration(trace.data.value.durationMs) }}</span>
          </div>
          <SpanTree :roots="roots" :total-ms="trace.data.value.durationMs" :selected-id="selectedNode?.spanId ?? null" @select="select" />
        </section>

        <SpanInspector v-if="selectedNode" :node="selectedNode" :empty-hint="hint" />
        <section v-else class="mt-card empty-card">Esta traza no tiene spans que mostrar.</section>
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
  gap: 10px;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--mt-muted);
  font-size: 12.5px;
  flex-shrink: 0;
  white-space: nowrap;
}
.crumbs.plain {
  padding: 0 8px;
}
.crumb {
  border: 0;
  background: none;
  padding: 0;
  color: #c4f26b;
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
h1,
h2 {
  margin: 0;
}
h1 {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}
h2 {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.head {
  box-sizing: border-box;
  padding: 4px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.head h1 {
  flex: 1;
  min-width: 0;
  padding-left: 10px;
  border-left: 1px solid var(--mt-line);
}
.sub {
  font-size: 12px;
  margin-right: 4px;
}
.pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.mt-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}
.mt-pill.error {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.mt-pill.unset {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.banner {
  padding: 12px 14px;
  border-radius: 18px;
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}
.banner.warn {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}
/* árbol ~40 % · inspector ~60 % */
.cols {
  display: grid;
  grid-template-columns: minmax(300px, 2fr) minmax(0, 3fr);
  gap: 10px;
  flex: 1;
  min-height: 0;
}
.tree-card {
  box-sizing: border-box;
  padding: 10px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  min-width: 0;
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
.empty-card {
  padding: 30px;
  color: var(--mt-muted);
}
@media (max-width: 1100px) {
  .cols {
    grid-template-columns: minmax(0, 1fr);
    overflow-y: auto;
  }
  .tree-card {
    max-height: 50vh;
  }
}
</style>
