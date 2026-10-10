<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { AssistantCardDto, ConnectionDto, ConnectionKindDto, ConnectionStatusDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { formatCount, formatPercent, formatRelativeTime } from "@/domain/format";
import { ORIGIN_LABEL, connectionOrigin, errorRate, isPendingReview } from "@/domain/assistants";
import EmptyState from "../EmptyState.vue";
import ErrorBanner from "../ErrorBanner.vue";
import StatusChip from "../StatusChip.vue";
import DeclareConnectionModal from "./DeclareConnectionModal.vue";
import Button from "../Button.vue";
import DataTable from "../DataTable.vue";
import LoadingState from "../LoadingState.vue";
import Card from "../Card.vue";

/** Pestaña «Connections»: servidores MCP, tools y agentes, declarados y observados (ADR-053). */
const props = defineProps<{ card: AssistantCardDto; canManage: boolean; canGovern: boolean; nowMs: number }>();
const emit = defineEmits<{ changed: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const connections = useAsync((signal) => api.listConnections(props.card.experimentId, signal));
onMounted(() => void connections.run());

const declaring = ref(false);
const busy = ref(false);

const GROUPS: { kind: ConnectionKindDto; title: string; hint: string }[] = [
  { kind: "mcp_server", title: "MCP servers", hint: "Tool servers the assistant connects to" },
  { kind: "tool", title: "Tools", hint: "Derived from tool spans, last 7 days" },
  { kind: "agent", title: "Agents it talks to", hint: "Other agents it calls" },
];
const STATUS = {
  approved: { tone: "ok", label: "Approved" },
  pending: { tone: "warn", label: "Pending review" },
  blocked: { tone: "error", label: "Blocked" },
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
const decide = (c: ConnectionDto, status: ConnectionStatusDto) => guarded(() => api.decideConnection(props.card.experimentId, c.id, status, null), "Could not save the decision");
const undeclare = (c: ConnectionDto) => guarded(() => api.undeclareConnection(props.card.experimentId, c.id), "Could not remove the declaration");
const sync = () =>
  guarded(async () => {
    const { observed } = await api.syncConnections(props.card.experimentId);
    $q.notify({ message: observed === 0 ? "No tool calls found in the last 7 days." : `${observed} tools found in traces.`, color: "primary", timeout: 3000 });
  }, "Could not read traces");
</script>

<template>
  <div class="connections">
    <section v-if="pending.length > 0" class="drift" role="status" data-testid="drift-banner">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
      <span><b>{{ pending.length }} {{ pending.length === 1 ? "connection was" : "connections were" }} seen in traces but not approved:</b> {{ pending.map((c) => c.name).join(", ") }}.</span>
    </section>

    <div v-if="canManage" class="toolbar">
      <Button :disabled="busy" @click="sync">Find tools in traces</Button>
      <Button @click="declaring = true">Declare connection</Button>
    </div>

    <ErrorBanner v-if="connections.error.value" :error="connections.error.value" @retry="connections.run()" />
    <LoadingState v-else-if="connections.loading.value && !connections.data.value" size="md" />
    <EmptyState v-else-if="(connections.data.value ?? []).length === 0" icon="hub" title="No connections yet">
      Declare what this assistant should use, or find the tools it already calls in its traces.
    </EmptyState>

    <template v-else>
      <Card as="section" padding="none" block v-for="g in groups" :key="g.kind" class="group" :data-testid="`group-${g.kind}`">
        <header><h2>{{ g.title }}</h2><span>{{ g.hint }}</span></header>
        <p v-if="g.items.length === 0" class="none">None yet.</p>
        <div v-else class="scroll">
          <DataTable class="grid" bare>
            <thead>
              <tr>
                <th>Name</th><th v-if="g.kind === 'tool'">Via</th><th>Source</th><th v-if="g.kind !== 'agent'" class="num">Calls</th><th v-if="g.kind !== 'agent'" class="num">Errors</th><th>Last seen</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in g.items" :key="c.id">
                <td class="name">{{ c.name }}<span v-if="g.kind === 'agent' && !c.peerExperimentId" class="outside">Not in catalog</span></td>
                <td v-if="g.kind === 'tool'" class="mono muted">{{ c.via ?? "local function" }}</td>
                <td class="muted">{{ ORIGIN_LABEL[connectionOrigin(c)] }}</td>
                <td v-if="g.kind !== 'agent'" class="num mono">{{ c.usage ? formatCount(c.usage.calls) : "–" }}</td>
                <td v-if="g.kind !== 'agent'" class="num mono" :class="{ bad: (errorRate(c.usage) ?? 0) >= 0.02 }">{{ errorRate(c.usage) === null ? "–" : formatPercent(errorRate(c.usage)!) }}</td>
                <td class="muted">{{ c.lastSeenAt ? formatRelativeTime(c.lastSeenAt, nowMs) : "never" }}</td>
                <td><StatusChip :tone="STATUS[c.status].tone" :label="STATUS[c.status].label" /></td>
                <td class="actions">
                  <template v-if="canGovern">
                    <Button variant="link" v-if="c.status !== 'approved'" :disabled="busy" @click="decide(c, 'approved')">Approve</Button>
                    <Button variant="link" v-if="c.status !== 'blocked'" :disabled="busy" @click="decide(c, 'blocked')" class="danger">Block</Button>
                  </template>
                  <Button variant="link" v-if="canManage && c.declared" :disabled="busy" @click="undeclare(c)" class="muted">Remove declaration</Button>
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
