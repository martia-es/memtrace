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
import { ORIGIN_LABEL, connectionOrigin, errorRate, isPendingReview } from "@/domain/assistants";
import EmptyState from "../EmptyState.vue";
import ErrorBanner from "../ErrorBanner.vue";
import StatusChip from "../StatusChip.vue";
import DeclareConnectionModal from "./DeclareConnectionModal.vue";
import Button from "../Button.vue";
import DataTable from "../DataTable.vue";
import LoadingState from "../LoadingState.vue";
import Card from "../Card.vue";
import { t, tp } from "../../i18n";

/** Pestaña «Connections»: servidores MCP, tools y agentes, declarados y observados (ADR-053). */
const props = defineProps<{ card: AssistantCardDto; canManage: boolean; canGovern: boolean; nowMs: number }>();
const emit = defineEmits<{ changed: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const filters = useFilters();
// el contador de llamadas sigue el rango global; el reloj no avanza solo, así que «Última hora» se recalcula al cambiar de rango o de pestaña
const connections = useAsync((signal) => api.listConnections(props.card.experimentId, filters.resolve(), signal));
watch(filters.rangeSig, () => void connections.run(), { immediate: true });

const declaring = ref(false);
const busy = ref(false);

const GROUPS: { kind: ConnectionKindDto; title: string; hint: string }[] = [
  { kind: "mcp_server", get title() { return t("assistantConnections.mcp_servers"); }, get hint() { return t("assistantConnections.tool_servers_the_assistant_connects_to"); } },
  { kind: "tool", get title() { return t("assistantConnections.tools"); }, get hint() { return t("assistantConnections.derived_from_tool_spans"); } },
  { kind: "agent", get title() { return t("assistantConnections.agents_it_talks_to"); }, get hint() { return t("assistantConnections.other_agents_it_calls"); } },
];
const STATUS = {
  approved: { tone: "ok", get label() { return t("assistantConnections.approved"); } },
  pending: { tone: "warn", get label() { return t("assistantConnections.pending_review"); } },
  blocked: { tone: "error", get label() { return t("assistantConnections.blocked"); } },
} as const;

const groups = computed(() => GROUPS.map((g) => ({ ...g, items: (connections.data.value ?? []).filter((c) => c.kind === g.kind) })));
const pending = computed(() => (connections.data.value ?? []).filter(isPendingReview));

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
    <section v-if="pending.length > 0" class="drift" role="status" data-testid="drift-banner">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
      <span><b>{{ tp("assistantConnections.seen", pending.length) }}</b> {{ pending.map((c) => c.name).join(", ") }}.</span>
    </section>

    <div v-if="canManage" class="toolbar">
      <Button :disabled="busy" @click="sync">{{ t("assistantConnections.find_tools_in_traces") }}</Button>
      <Button @click="declaring = true">{{ t("assistantConnections.declare_connection") }}</Button>
    </div>

    <ErrorBanner v-if="connections.error.value" :error="connections.error.value" @retry="connections.run()" />
    <LoadingState v-else-if="connections.loading.value && !connections.data.value" size="md" />
    <EmptyState v-else-if="(connections.data.value ?? []).length === 0" icon="hub" :title="t('assistantConnections.no_connections_yet')">
      {{ t("assistantConnections.declare_what_this_assistant_should_use") }}
    </EmptyState>

    <template v-else>
      <Card as="section" padding="none" block v-for="g in groups" :key="g.kind" class="group" :data-testid="`group-${g.kind}`">
        <header><h2>{{ g.title }}</h2><span>{{ g.hint }}</span></header>
        <p v-if="g.items.length === 0" class="none">{{ t("assistantConnections.none_yet") }}</p>
        <div v-else class="scroll">
          <DataTable class="grid" bare>
            <thead>
              <tr>
                <th>{{ t("assistantConnections.name") }}</th><th v-if="g.kind === 'tool'">{{ t("assistantConnections.via") }}</th><th>{{ t("assistantConnections.source") }}</th><th v-if="g.kind !== 'agent'" class="num">{{ t("assistantConnections.calls") }}</th><th v-if="g.kind !== 'agent'" class="num">{{ t("assistantConnections.errors") }}</th><th>{{ t("assistantConnections.last_seen") }}</th><th>{{ t("assistantConnections.status") }}</th><th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in g.items" :key="c.id">
                <td class="name">{{ c.name }}<span v-if="g.kind === 'agent' && !c.peerExperimentId" class="outside">{{ t("assistantConnections.not_in_catalog") }}</span></td>
                <td v-if="g.kind === 'tool'" class="mono muted">{{ c.via ?? t("assistantConnections.local_function") }}</td>
                <td class="muted">{{ ORIGIN_LABEL[connectionOrigin(c)] }}</td>
                <td v-if="g.kind !== 'agent'" class="num mono">{{ c.usage ? formatCount(c.usage.calls) : "–" }}</td>
                <td v-if="g.kind !== 'agent'" class="num mono" :class="{ bad: (errorRate(c.usage) ?? 0) >= 0.02 }">{{ errorRate(c.usage) === null ? "–" : formatPercent(errorRate(c.usage)!) }}</td>
                <td class="muted">{{ c.lastSeenAt ? formatRelativeTime(c.lastSeenAt, nowMs) : t("assistantConnections.never") }}</td>
                <td><StatusChip :tone="STATUS[c.status].tone" :label="STATUS[c.status].label" /></td>
                <td class="actions">
                  <template v-if="canGovern">
                    <Button variant="link" v-if="c.status !== 'approved'" :disabled="busy" @click="decide(c, 'approved')">{{ t("assistantConnections.approve") }}</Button>
                    <Button variant="link" v-if="c.status !== 'blocked'" :disabled="busy" @click="decide(c, 'blocked')" class="danger">{{ t("assistantConnections.block") }}</Button>
                  </template>
                  <Button variant="link" v-if="canManage && c.declared" :disabled="busy" @click="undeclare(c)" class="muted">{{ t("assistantConnections.remove_declaration") }}</Button>
                </td>
              </tr>
            </tbody>
          </DataTable>
        </div>
      </Card>
    </template>
    <DeclareConnectionModal v-if="declaring" :experiment-id="card.experimentId" @close="declaring = false" @saved="connections.run(); emit('changed')" />
  </div>
</template>

<style scoped>
.connections { display: flex; flex-direction: column; gap: 12px; }
.drift { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border-radius: var(--mt-radius-lg); background: var(--mt-warn-bg); color: var(--mt-warn-ink); border: 1px solid color-mix(in srgb, var(--mt-warn) 40%, transparent); font-weight: 600; }
.toolbar { display: flex; gap: 8px; }
.ghost { height: 30px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-text); background: transparent; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.ghost:disabled { opacity: 0.5; }
.group { padding: 0; overflow: hidden; }
header { display: flex; align-items: baseline; gap: 10px; padding: 12px 16px; }
h2 { margin: 0; font-size: 14px; font-weight: 800; }
header span { font-size: 12px; color: var(--mt-muted); }
.none { margin: 0; padding: 4px 16px 14px; font-size: 13px; color: var(--mt-faint); }
.scroll { overflow-x: auto; }

th:first-child, td:first-child { padding-left: 16px; }
.num { text-align: right; }
.mono { font-family: var(--mt-mono); font-size: 12px; }
.name { font-family: var(--mt-mono); font-weight: 500; font-size: 12.5px; }
.muted { color: var(--mt-muted); }
.bad { color: var(--mt-err-ink); font-weight: 700; }
.outside { margin-left: 8px; padding: 1px 7px; border-radius: var(--mt-radius-xs); font-family: var(--mt-sans); font-size: 11px; font-weight: 700; background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.actions { text-align: right; }
.link { margin-left: 12px; font: inherit; font-size: 12px; font-weight: 700; color: var(--mt-accent-text); background: none; border: none; cursor: pointer; }
.link.danger { color: var(--mt-err-ink); }
.link.muted { color: var(--mt-muted); font-weight: 600; }
.link:hover:not(:disabled) { text-decoration: underline; }
.link:disabled { opacity: 0.5; }
</style>
