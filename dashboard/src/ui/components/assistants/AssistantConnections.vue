<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { AssistantCardDto, ConnectionDto, ConnectionKindDto, ConnectionStatusDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { useFilters } from "../../composables/useFilters";
import { formatCount, formatPercent } from "@/domain/format";
import { formatRelativeTime } from "../../i18n/format";
import { ORIGIN_LABEL, connectionOrigin, errorRate } from "@/domain/assistants";
import { RANGE_PRESETS, earliestCustomDay } from "@/domain/time-range";
import EmptyState from "../EmptyState.vue";
import ErrorBanner from "../ErrorBanner.vue";
import StatusChip from "../StatusChip.vue";
import DeclareConnectionModal from "./DeclareConnectionModal.vue";
import Button from "../Button.vue";
import LoadingState from "../LoadingState.vue";
import Menu from "../Menu.vue";
import { t } from "../../i18n";

/** Sección «Connections»: servidores MCP, tools y agentes, declarados y observados, como tarjetas (ADR-053). */
const props = defineProps<{ card: AssistantCardDto; canManage: boolean; canGovern: boolean; nowMs: number }>();
const emit = defineEmits<{ changed: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const filters = useFilters();
// el contador de llamadas sigue el rango global; el reloj no avanza solo, así que «Última hora» se recalcula al cambiar de rango
const connections = useAsync((signal) => api.listConnections(props.card.experimentId, filters.resolve(), signal));
watch(filters.rangeSig, () => void connections.run(), { immediate: true });

const declaring = ref(false);
const busy = ref(false);

type StatusFilter = "all" | ConnectionStatusDto;
const filter = ref<StatusFilter>("all");
const KIND_ICON: Record<ConnectionKindDto, string> = { mcp_server: "dns", tool: "build", agent: "smart_toy" };
const kindLabel = (k: ConnectionKindDto) => (k === "mcp_server" ? t("assistantConnections.kind_mcp_server") : k === "tool" ? t("assistantConnections.kind_tool") : t("assistantConnections.kind_agent"));
const STATUS = {
  approved: { tone: "ok", get label() { return t("assistantConnections.approved"); } },
  pending: { tone: "warn", get label() { return t("assistantConnections.pending_review"); } },
  blocked: { tone: "error", get label() { return t("assistantConnections.blocked"); } },
} as const;

const all = computed(() => connections.data.value ?? []);
const tabs = computed(() => [
  { id: "all" as const, label: t("assistantConnections.filter_all"), n: all.value.length },
  ...(["pending", "approved", "blocked"] as const).map((id) => ({ id, label: STATUS[id].label, n: all.value.filter((c) => c.status === id).length })),
]);
const shown = computed(() => (filter.value === "all" ? all.value : all.value.filter((c) => c.status === filter.value)));

// selector de rango: los presets de la barra global en un desplegable (un rango propio abre fechas)
const rangeLabel = computed(() => {
  if (filters.range.value === "custom" && filters.customRange.value) {
    const fmt = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    return `${fmt(filters.customRange.value.from)} – ${fmt(filters.customRange.value.to)}`;
  }
  return t(`range.${filters.range.value === "custom" ? "1h" : filters.range.value}`);
});
const earliestDay = earliestCustomDay(Date.now());
const from = ref(filters.customRange.value?.from ?? "");
const to = ref(filters.customRange.value?.to ?? "");
const customValid = computed(() => Boolean(from.value) && Boolean(to.value) && from.value <= to.value && from.value >= earliestDay);
const rangeMenu = ref<{ hide: () => void } | null>(null);
function pick(key: (typeof RANGE_PRESETS)[number]["key"]) {
  filters.setRange(key);
  rangeMenu.value?.hide();
}
function applyCustom() {
  filters.setCustomRange({ from: from.value, to: to.value });
  rangeMenu.value?.hide();
}

async function guarded(action: () => Promise<unknown>, failure: string) {
  busy.value = true;
  try {
    await action();
    await connections.run();
    emit("changed");
  } catch (error) {
    $q.notify({ message: `${failure}: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
  } finally {
    busy.value = false;
  }
}
const decide = (c: ConnectionDto, status: ConnectionStatusDto) => guarded(() => api.decideConnection(props.card.experimentId, c.id, status, null), t("assistantConnections.could_not_save_the_decision"));
const undeclare = (c: ConnectionDto) => guarded(() => api.undeclareConnection(props.card.experimentId, c.id), t("assistantConnections.could_not_remove_the_declaration"));
const sync = () =>
  guarded(async () => {
    const { observed } = await api.syncConnections(props.card.experimentId);
    $q.notify({ message: observed === 0 ? t("assistantConnections.no_tool_calls_found_in_the") : t("assistantConnections.count_tools_found_in_traces", { count: observed }), color: "primary", timeout: 3000 });
  }, t("assistantConnections.could_not_read_traces"));
</script>

<template>
  <div class="connections">
    <div class="toolbar">
      <div class="seg" role="group" :aria-label="t('assistantConnections.filter_by_status')">
        <Button v-for="f in tabs" :key="f.id" variant="link" class="seg-btn" :aria-pressed="filter === f.id" :data-testid="`filter-${f.id}`" @click="filter = f.id">{{ f.label }}<span class="n">{{ f.n }}</span></Button>
      </div>
      <div class="spacer" />
      <Button variant="link" class="range" aria-haspopup="listbox" data-testid="calls-range">
        <span class="muted">{{ t("assistantConnections.calls_in") }}</span>{{ rangeLabel }}<q-icon name="expand_more" size="16px" />
        <Menu ref="rangeMenu" anchor="bottom right" self="top right" :offset="[0, 6]">
          <div class="menu">
            <Button v-for="p in RANGE_PRESETS" :key="p.key" variant="link" class="opt" :aria-pressed="p.key === filters.range.value" @click="pick(p.key)">{{ t(`range.${p.key}`) }}</Button>
            <form class="custom" @submit.prevent="customValid && applyCustom()">
              <label>{{ t("filter.from") }} <input v-model="from" type="date" :min="earliestDay" :max="to || undefined" required /></label>
              <label>{{ t("filter.to") }} <input v-model="to" type="date" :min="from || earliestDay" required /></label>
              <Button variant="primary" size="sm" type="submit" :disabled="!customValid">{{ t("common.apply") }}</Button>
            </form>
          </div>
        </Menu>
      </Button>
    </div>

    <ErrorBanner v-if="connections.error.value" :error="connections.error.value" @retry="connections.run()" />
    <LoadingState v-else-if="connections.loading.value && !connections.data.value" size="md" />
    <template v-else>
      <EmptyState v-if="all.length === 0 && !canManage" icon="hub" :title="t('assistantConnections.no_connections_yet')">
        {{ t("assistantConnections.declare_what_this_assistant_should_use") }}
      </EmptyState>
      <ul v-else class="grid">
        <li v-for="c in shown" :key="c.id" class="conn" :class="{ pending: c.status === 'pending' }" :data-testid="`connection-${c.id}`" :data-kind="c.kind">
          <div class="top">
            <span class="icon"><q-icon :name="KIND_ICON[c.kind]" size="18px" /></span>
            <div class="id">
              <span class="name">{{ c.name }}<span v-if="c.kind === 'agent' && !c.peerExperimentId" class="outside">{{ t("assistantConnections.not_in_catalog") }}</span></span>
              <span class="muted">{{ kindLabel(c.kind) }}<template v-if="c.kind === 'tool'"> · {{ c.via ?? t("assistantConnections.local_function") }}</template></span>
            </div>
            <StatusChip :tone="STATUS[c.status].tone" :label="STATUS[c.status].label" />
          </div>
          <div v-if="c.kind !== 'agent'" class="usage">
            <div class="calls"><b>{{ c.usage ? formatCount(c.usage.calls) : "–" }}</b><span>{{ t("assistantConnections.calls") }}</span></div>
            <div class="errors">
              <div class="row"><span>{{ t("assistantConnections.errors") }}</span><b :class="{ bad: (errorRate(c.usage) ?? 0) >= 0.02 }">{{ errorRate(c.usage) === null ? "–" : formatPercent(errorRate(c.usage)!) }}</b></div>
              <div class="track"><div class="fill" :style="{ width: `${Math.min(100, Math.round((errorRate(c.usage) ?? 0) * 100))}%` }" /></div>
            </div>
          </div>
          <p v-else class="muted">{{ t("assistantConnections.not_measured_yet") }}</p>
          <p class="muted meta">{{ ORIGIN_LABEL[connectionOrigin(c)] }} · {{ t("assistantConnections.last_seen").toLowerCase() }} {{ c.lastSeenAt ? formatRelativeTime(c.lastSeenAt, nowMs) : t("assistantConnections.never") }}</p>
          <div v-if="canGovern || (canManage && c.declared)" class="foot">
            <template v-if="canGovern">
              <Button variant="primary" v-if="c.status !== 'approved'" :disabled="busy" @click="decide(c, 'approved')">{{ t("assistantConnections.approve") }}</Button>
              <Button v-if="c.status !== 'blocked'" :disabled="busy" class="danger" @click="decide(c, 'blocked')">{{ t("assistantConnections.block") }}</Button>
            </template>
            <div class="spacer" />
            <Button variant="link" v-if="canManage && c.declared" :disabled="busy" @click="undeclare(c)">{{ t("assistantConnections.remove_declaration") }}</Button>
          </div>
        </li>
        <li v-if="canManage && filter === 'all'" class="add">
          <Button variant="link" class="add-btn" :disabled="busy" data-testid="find-tools" @click="sync"><span class="plus"><q-icon name="search" size="18px" /></span><b>{{ t("assistantConnections.find_tools_in_traces") }}</b><span class="muted">{{ t("assistantConnections.find_hint") }}</span></Button>
        </li>
        <li v-if="canManage && filter === 'all'" class="add">
          <Button variant="link" class="add-btn" data-testid="declare" @click="declaring = true"><span class="plus"><q-icon name="add" size="18px" /></span><b>{{ t("assistantConnections.declare_connection") }}</b><span class="muted">{{ t("assistantConnections.declare_hint") }}</span></Button>
        </li>
      </ul>
      <p v-if="all.length > 0 && shown.length === 0" class="muted">{{ t("assistantConnections.none_in_filter") }}</p>
    </template>
    <DeclareConnectionModal v-if="declaring" :experiment-id="card.experimentId" @close="declaring = false" @saved="connections.run(); emit('changed')" />
  </div>
</template>

<style scoped>
.connections { display: flex; flex-direction: column; gap: 12px; }
.toolbar { display: flex; align-items: center; gap: 10px; }
.spacer { flex: 1; }
.muted { color: var(--mt-muted); font-size: 12px; }
.seg { display: flex; height: 30px; overflow: hidden; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: var(--mt-card); }
.seg .seg-btn { display: flex; align-items: center; gap: 6px; padding: 0 12px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--mt-muted); background: transparent; border: 0; cursor: pointer; }
.seg .seg-btn[aria-pressed="true"] { background: var(--mt-accent-tint); color: var(--mt-accent-text); }
.seg .n { padding: 0 5px; border-radius: 4px; background: var(--mt-bg); font-size: 11px; font-weight: 800; }
.toolbar .range { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px 0 12px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--mt-ink); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.range .muted { font-weight: 600; }
.menu { display: flex; flex-direction: column; gap: 2px; padding: 6px; min-width: 190px; }
.menu .opt { text-align: left; padding: 6px 10px; font: inherit; font-size: 12.5px; font-weight: 600; color: var(--mt-ink); background: transparent; border: 0; border-radius: var(--mt-radius-xs); cursor: pointer; }
.menu .opt:hover { background: var(--mt-bg); }
.menu .opt[aria-pressed="true"] { background: var(--mt-accent-tint); color: var(--mt-accent-text); }
.custom { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding: 10px 6px 4px; border-top: 1px solid var(--mt-line); font-size: 12px; }
.custom label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
.conn { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 14px 16px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); }
.conn.pending { border: 1.5px solid var(--mt-warn); padding: 13.5px 15.5px; }
.top { display: flex; align-items: center; gap: 10px; }
.icon { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: var(--mt-radius); background: var(--mt-bg); color: var(--mt-accent-text); }
.id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.name { font-family: var(--mt-mono); font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.outside { margin-left: 8px; padding: 1px 7px; border-radius: var(--mt-radius-xs); font-family: var(--mt-sans); font-size: 11px; font-weight: 700; background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.usage { display: flex; align-items: flex-end; gap: 18px; }
.calls { display: flex; flex-direction: column; gap: 3px; line-height: 1.1; }
.calls b { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.calls span { font-size: 11px; color: var(--mt-faint); }
.errors { flex: 1; display: flex; flex-direction: column; gap: 5px; padding-bottom: 2px; }
.errors .row { display: flex; justify-content: space-between; font-size: 11px; color: var(--mt-faint); }
.errors .row b { font-weight: 700; color: var(--mt-muted); }
.errors .row b.bad { color: var(--mt-err-ink); }
.track { height: 6px; border-radius: 3px; background: var(--mt-bg); }
.fill { height: 6px; min-width: 2px; border-radius: 3px; background: var(--mt-err); }
.meta { margin: 0; }
p.muted { margin: 0; }
.foot { display: flex; align-items: center; gap: 8px; padding-top: 11px; border-top: 1px solid var(--mt-line-2); }
.add { display: flex; }
.add .add-btn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 150px; padding: 14px 16px; font: inherit; text-align: center; color: var(--mt-ink); background: transparent; border: 1.5px dashed var(--mt-line); border-radius: var(--mt-radius-lg); cursor: pointer; }
.add .add-btn:hover:not(:disabled) { border-color: var(--mt-accent); background: var(--mt-accent-tint); }
.add .add-btn:disabled { opacity: 0.5; cursor: default; }
.plus { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; background: var(--mt-accent-tint); color: var(--mt-accent-text); }
.add b { font-weight: 800; }
</style>
