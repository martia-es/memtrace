<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { describeApiError } from "@/application/describe-api-error";
import type { DeploymentSummaryDto } from "@contract";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { chatUrl } from "@/domain/chat-dock";
import { formatDuration, formatRelativeTime } from "@/domain/format";
import { DEPLOY_STATUS, HEALTH_LABEL, HEALTH_TONE, accessSummary, authSummary, formatUptime, uptimePercent } from "@/domain/assistants";
import StatusChip from "../StatusChip.vue";
import HealthBars from "./HealthBars.vue";

/** Un entorno de un asistente: estado de /health, disponibilidad de 24 h y datos del despliegue (ADR-053). */
const props = defineProps<{ experimentId: string; deployment: DeploymentSummaryDto; selected: boolean; canManage: boolean; nowMs: number; chatPath?: string | null; talkable?: boolean; deployable?: boolean; refreshKey?: number }>();
const emit = defineEmits<{ select: []; edit: []; checked: []; talk: []; deploy: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const checking = ref(false);
const history = useAsync((signal) => api.getHealthHistory(props.experimentId, props.deployment.id, 24, signal));
onMounted(() => void history.run());
// último despliegue lanzado desde MemTrace (ADR-064); se vuelve a leer tras lanzar uno
const deploys = useAsync((signal) => api.listDeploys(props.experimentId, props.deployment.id, signal));
onMounted(() => void deploys.run().catch(() => undefined));
watch(() => props.refreshKey, () => void deploys.run());
const lastDeploy = computed(() => deploys.data.value?.[0] ?? null);
// un sondeo nuevo cambia `healthCheckedAt`: se vuelve a leer el historial
watch(() => props.deployment.healthCheckedAt, () => void history.run());

async function checkNow() {
  checking.value = true;
  try {
    await api.checkDeploymentNow(props.experimentId, props.deployment.id);
    emit("checked");
  } catch (error) {
    $q.notify({ message: `Could not check the health: ${describeApiError(error as Error)}`, color: "negative", timeout: 4000 });
  } finally {
    checking.value = false;
  }
}

const checks = computed(() => history.data.value ?? []);
const d = computed(() => props.deployment);
const rows = computed<Array<[string, string]>>(() => [
  ["API", d.value.apiUrl],
  ["Health", d.value.healthUrl ?? `${d.value.apiUrl.replace(/\/+$/, "")}/health`],
  ["Latency", d.value.healthLatencyMs !== null ? `${formatDuration(d.value.healthLatencyMs)}${d.value.healthCheckedAt ? ` · ${formatRelativeTime(d.value.healthCheckedAt, props.nowMs)}` : ""}` : d.value.healthCheckEnabled ? "No check yet" : "Checks off"],
  ...(props.chatPath ? ([["Chat", chatUrl(d.value.apiUrl, props.chatPath)]] as Array<[string, string]>) : []),
  ["Version", d.value.version ?? "–"],
  ...(lastDeploy.value ? ([["Last deploy", `${DEPLOY_STATUS[lastDeploy.value.status]?.label ?? lastDeploy.value.status} · ${lastDeploy.value.commitSha.slice(0, 7)} · ${formatRelativeTime(lastDeploy.value.createdAt, props.nowMs)}${lastDeploy.value.gateBypassed ? " · evaluation skipped" : ""}`]] as Array<[string, string]>) : []),
  ...(d.value.deployRef ? ([["Deploys from", d.value.deployRef]] as Array<[string, string]>) : []),
  ["Auth", authSummary(d.value)],
  ["Access", accessSummary(d.value)],
]);
const mono = new Set(["API", "Health", "Chat", "Latency", "Version", "Deploys from", "Last deploy"]);
</script>

<template>
  <article class="env" :class="{ selected }" :data-testid="`deployment-${deployment.environment.key}`">
    <header class="head">
      <span class="key">{{ deployment.environment.label }}</span>
      <StatusChip :tone="HEALTH_TONE[deployment.healthStatus]" :label="HEALTH_LABEL[deployment.healthStatus]" />
      <div class="spacer" />
      <button v-if="deployable" type="button" class="talk" data-testid="deploy" @click="emit('deploy')"><q-icon name="rocket_launch" size="14px" />Deploy</button>
      <button v-if="talkable" type="button" class="talk" data-testid="talk" @click="emit('talk')"><q-icon name="chat_bubble_outline" size="14px" />Chat</button>
      <button v-if="canManage" type="button" class="link" :disabled="checking" data-testid="check-now" @click="checkNow"><q-icon name="sync" size="14px" :class="{ spin: checking }" />{{ checking ? "Syncing…" : "Sync" }}</button>
      <button v-if="canManage" type="button" class="link" @click="emit('edit')"><q-icon name="edit" size="14px" />Edit</button>
    </header>
    <div class="uptime">
      <HealthBars :checks="checks" :now-ms="nowMs" />
      <div class="uptime-legend"><span>24 h ago</span><span><b>{{ formatUptime(uptimePercent(checks)) }}</b> uptime</span><span>now</span></div>
    </div>
    <dl class="rows">
      <template v-for="[label, value] in rows" :key="label">
        <dt>{{ label }}</dt>
        <dd :class="{ mono: mono.has(label) }" :title="value">{{ value }}</dd>
      </template>
    </dl>
    <button type="button" class="select" :aria-pressed="selected" @click="emit('select')">{{ selected ? "Showing who can call it" : "Show who can call it" }}</button>
  </article>
</template>

<style scoped>
.env { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 14px 16px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); }
.env.selected { border-color: var(--mt-accent); }
.head { display: flex; align-items: center; gap: 10px; }
.key { font-family: var(--mt-mono); font-size: 14px; font-weight: 500; letter-spacing: 0.02em; }
.spacer { flex: 1; }
.link { display: inline-flex; align-items: center; gap: 4px; }
.talk { display: inline-flex; align-items: center; gap: 5px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.link, .select { font: inherit; font-size: 12px; font-weight: 700; color: var(--mt-accent-text); background: none; border: none; padding: 0; cursor: pointer; }
.talk { height: 26px; padding: 0 12px; font: inherit; font-size: 12px; font-weight: 700; color: var(--mt-accent-ink); background: var(--mt-accent); border: none; border-radius: var(--mt-radius-sm); cursor: pointer; }
.talk:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
.link:hover:not(:disabled), .select:hover { text-decoration: underline; }
.link:disabled { opacity: 0.5; cursor: default; }
.head .link + .link { margin-left: 4px; }
.select { align-self: flex-start; }
.select[aria-pressed="true"] { color: var(--mt-muted); cursor: default; text-decoration: none; }
.uptime { display: flex; flex-direction: column; gap: 5px; }
.uptime-legend { display: flex; justify-content: space-between; font-size: 11px; color: var(--mt-faint); }
.uptime-legend b { font-family: var(--mt-mono); font-weight: 500; color: var(--mt-ink); }
.rows { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 7px 10px; margin: 0; padding-top: 8px; border-top: 1px solid var(--mt-line-2); font-size: 12px; }
dt { color: var(--mt-muted); }
dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
dd.mono { font-family: var(--mt-mono); font-size: 11.5px; }
</style>
