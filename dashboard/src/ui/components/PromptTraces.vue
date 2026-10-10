<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { describeApiError } from "@/application/describe-api-error";
import { RANGE_PRESETS, resolveRange, type RangeKey } from "@/domain/time-range";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import EmptyState from "./EmptyState.vue";
import Select from "./Select.vue";
import TraceTable from "./TraceTable.vue";
import LoadingState from "./LoadingState.vue";

/**
 * Todas las trazas que usaron este prompt, de una versión o de todas (ADR-068). Es la otra cara de Evidence: allí las cifras,
 * aquí las trazas concretas. Cada fila abre su traza; «Open in Conversations» lleva la misma búsqueda a la lista completa.
 */
const props = defineProps<{ promptName: string; versions: number[]; selected: number | null }>();
const api = useTraceApi();
const route = useRoute();
const router = useRouter();

const LIMIT = 50;
const version = ref<string>(props.selected === null ? "" : String(props.selected));
watch(() => props.selected, (v) => (version.value = v === null ? "" : String(v)));
const rangeKey = ref<RangeKey>("30d");
const rangeOptions = RANGE_PRESETS.filter((r) => ["24h", "7d", "30d"].includes(r.key)).map((r) => ({ label: r.long, value: r.key }));
const versionOptions = computed(() => [{ label: "All versions", value: "" }, ...props.versions.map((v) => ({ label: `v${v}`, value: String(v) }))]);

const traces = useAsync((signal) =>
  api.listTraces({ ...resolveRange(rangeKey.value, Date.now()), promptName: props.promptName, promptVersion: version.value ? Number(version.value) : undefined, limit: LIMIT }, signal),
);
watch([version, rangeKey, () => props.promptName], () => void traces.run(), { immediate: true });

const items = computed(() => traces.data.value?.items ?? []);
const experimentId = computed(() => String(route.params.experimentId));
const openTrace = (traceId: string) => void router.push({ name: "trace", params: { experimentId: experimentId.value, traceId } });
const openConversation = (conversationId: string) => void router.push({ name: "conversation", params: { experimentId: experimentId.value, conversationId } });
const allLink = computed(() => ({
  name: "conversations",
  params: { experimentId: experimentId.value },
  query: { group: "flat", prompt: props.promptName, ...(version.value ? { pv: version.value } : {}), ...(rangeKey.value !== "1h" ? { range: rangeKey.value } : {}) },
}));
</script>

<template>
  <div class="prompt-traces" data-testid="prompt-traces">
    <div class="bar">
      <Select v-model="version" :options="versionOptions" aria-label="Version" data-testid="traces-version" />
      <Select v-model="rangeKey" :options="rangeOptions" aria-label="Range" data-testid="traces-range" />
      <span class="grow" />
      <router-link :to="allLink" class="link" data-testid="traces-open-all">Open in Conversations →</router-link>
    </div>
    <p v-if="traces.error.value" class="problem" role="alert">{{ describeApiError(traces.error.value) }}</p>
    <LoadingState v-else-if="traces.loading.value && !traces.data.value" size="md" />
    <EmptyState v-else-if="items.length === 0" icon="manage_search" title="No traces for this selection" data-testid="traces-empty">
      No trace used {{ promptName }}{{ version ? ` v${version}` : "" }} in this range. Traces show up when an agent calls <code>compile()</code> inside a traced step.
    </EmptyState>
    <template v-else>
      <TraceTable :items="items" show-prompts show-conversation @open="openTrace" @open-conversation="openConversation" />
      <p class="soft small" data-testid="traces-count">{{ items.length === LIMIT ? `Showing the latest ${LIMIT}.` : `${items.length} ${items.length === 1 ? "trace" : "traces"}.` }}</p>
    </template>
  </div>
</template>

<style scoped>
.prompt-traces {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.grow {
  flex: 1;
}
.link {
  font-size: 13px;
}
.small {
  margin: 0;
  font-size: 12px;
}
.problem {
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--mt-err-ink);
  background: var(--mt-err-bg);
}
</style>
