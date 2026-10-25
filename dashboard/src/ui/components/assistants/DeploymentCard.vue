<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useQuasar } from "quasar";
import { describeApiError } from "@/application/describe-api-error";
import type { DeploymentSummaryDto, RepoConfigDto } from "@contract";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { chatUrl } from "@/domain/chat-dock";
import { formatDuration } from "@/domain/format";
import { formatRelativeTime } from "../../i18n/format";
import { DEPLOY_STATUS, HEALTH_LABEL, HEALTH_TONE, accessSummary, authSummary, formatUptime, uptimePercent } from "@/domain/assistants";
import CommitLink from "../CommitLink.vue";
import StatusChip from "../StatusChip.vue";
import HealthBars from "./HealthBars.vue";
import Button from "../Button.vue";
import { t } from "../../i18n";

/** Un entorno de un asistente: estado de /health, disponibilidad de 24 h y datos del despliegue (ADR-053). */
const props = defineProps<{ experimentId: string; deployment: DeploymentSummaryDto; selected: boolean; canManage: boolean; nowMs: number; chatPath?: string | null; talkable?: boolean; deployable?: boolean; refreshKey?: number; repo?: RepoConfigDto | null }>();
const emit = defineEmits<{ select: []; edit: []; checked: []; talk: []; deploy: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const checking = ref(false);
const open = ref(false);
const history = useAsync((signal) => api.getHealthHistory(props.experimentId, props.deployment.id, 24, signal));
onMounted(() => void history.run());
// último despliegue lanzado desde MemTrace (ADR-064); se vuelve a leer tras lanzar uno
const deploys = useAsync((signal) => api.listDeploys(props.experimentId, props.deployment.id, signal));
onMounted(() => void deploys.run().catch(() => undefined));
watch(() => props.refreshKey, () => void deploys.run());
const lastDeploy = computed(() => deploys.data.value?.[0] ?? null);
// el commit que corre hoy en el entorno: el último despliegue que terminó bien (el último intento puede estar en curso o haber fallado)
const deployed = computed(() => deploys.data.value?.find((x) => x.status === "succeeded") ?? null);
// un sondeo nuevo cambia `healthCheckedAt`: se vuelve a leer el historial
watch(() => props.deployment.healthCheckedAt, () => void history.run());

async function checkNow() {
  checking.value = true;
  try {
    await api.checkDeploymentNow(props.experimentId, props.deployment.id);
    emit("checked");
  } catch (error) {
    $q.notify({ message: t("deploymentCard.could_not_check_the_health_error", { error: describeApiError(error as Error) }), color: "negative", timeout: 4000 });
  } finally {
    checking.value = false;
  }
}

const checks = computed(() => history.data.value ?? []);
const d = computed(() => props.deployment);
const rows = computed<Array<[string, string]>>(() => [
  [t("deploymentCard.api"), d.value.apiUrl],
  [t("deploymentCard.health"), d.value.healthUrl ?? `${d.value.apiUrl.replace(/\/+$/, "")}/health`],
  [t("deploymentCard.latency"), d.value.healthLatencyMs !== null ? `${formatDuration(d.value.healthLatencyMs)}${d.value.healthCheckedAt ? ` · ${formatRelativeTime(d.value.healthCheckedAt, props.nowMs)}` : ""}` : d.value.healthCheckEnabled ? t("deploymentCard.no_check_yet") : t("deploymentCard.checks_off")],
  ...(props.chatPath ? ([[t("deploymentCard.chat"), chatUrl(d.value.apiUrl, props.chatPath)]] as Array<[string, string]>) : []),
  [t("deploymentCard.version"), d.value.version ?? "–"],
  ...(deployed.value ? ([[t("deploymentCard.deployed"), formatRelativeTime(deployed.value.createdAt, props.nowMs)]] as Array<[string, string]>) : []),
  ...(lastDeploy.value ? ([[t("deploymentCard.last_deploy"), `${DEPLOY_STATUS[lastDeploy.value.status]?.label ?? lastDeploy.value.status} · ${lastDeploy.value.commitSha.slice(0, 7)} · ${formatRelativeTime(lastDeploy.value.createdAt, props.nowMs)}${lastDeploy.value.gateBypassed ? ` · ${t("deploymentCard.evaluation_skipped")}` : ""}`]] as Array<[string, string]>) : []),
  ...(d.value.deployRef ? ([[t("deploymentCard.deploys_from"), d.value.deployRef]] as Array<[string, string]>) : []),
  [t("deploymentCard.auth"), authSummary(d.value)],
  [t("deploymentCard.access"), accessSummary(d.value)],
]);
const mono = computed(() => new Set([t("deploymentCard.api"), t("deploymentCard.health"), t("deploymentCard.chat"), t("deploymentCard.latency"), t("deploymentCard.version"), t("deploymentCard.deploys_from"), t("deploymentCard.last_deploy"), t("deploymentCard.deployed")]));
</script>

<template>
  <article class="env" :class="{ selected }" :data-testid="`deployment-${deployment.environment.key}`">
    <header class="head">
      <span class="key">{{ deployment.environment.label }}</span>
      <StatusChip :tone="HEALTH_TONE[deployment.healthStatus]" :label="HEALTH_LABEL[deployment.healthStatus]" />
      <div class="spacer" />
      <Button size="sm" v-if="deployable" data-testid="deploy" @click="emit('deploy')"><q-icon name="rocket_launch" size="14px" />{{ t("deploymentCard.deploy") }}</Button>
      <Button size="sm" v-if="talkable" data-testid="talk" @click="emit('talk')"><q-icon name="chat_bubble_outline" size="14px" />{{ t("deploymentCard.chat") }}</Button>
      <Button variant="link" v-if="canManage" :disabled="checking" data-testid="check-now" @click="checkNow"><q-icon name="sync" size="14px" :class="{ spin: checking }" />{{ checking ? t("deploymentCard.syncing") : t("deploymentCard.sync") }}</Button>
      <Button variant="link" v-if="canManage" @click="emit('edit')"><q-icon name="edit" size="14px" />{{ t("deploymentCard.edit") }}</Button>
    </header>
    <div class="metrics">
      <div class="metric"><b class="big">{{ formatUptime(uptimePercent(checks)) }}</b><span>{{ t("deploymentCard.uptime_last_24_h") }}</span></div>
      <div class="metric end"><b class="mid">{{ d.healthLatencyMs !== null ? formatDuration(d.healthLatencyMs) : "–" }}</b><span>{{ t("deploymentCard.latency") }}</span></div>
    </div>
    <HealthBars :checks="checks" :now-ms="nowMs" />
    <div class="ident">
      <span v-if="d.version" class="ver">{{ d.version }}</span>
      <span class="api" :title="d.apiUrl">{{ d.apiUrl }}</span>
    </div>
    <dl v-show="open" class="rows">
      <template v-for="[label, value] in rows" :key="label">
        <dt>{{ label }}</dt>
        <dd v-if="label === 'Deployed' && deployed" class="deployed" data-testid="deployed-commit"><CommitLink :revision="deployed.commitSha" :repo="repo" /><span class="muted">{{ value }}</span></dd>
        <dd v-else :class="{ mono: mono.has(label) }" :title="value">{{ value }}</dd>
      </template>
    </dl>
    <Button variant="link" class="foot" :aria-pressed="selected" :title="selected ? t('deploymentCard.showing_who_can_call_it') : t('deploymentCard.show_who_can_call_it')" @click="emit('select')">
      <span class="who">{{ accessSummary(d) }}</span>
      <span class="grow" />
      <q-icon :name="selected ? 'expand_more' : 'chevron_right'" size="18px" />
    </Button>
    <Button variant="link" class="more" :aria-expanded="open" @click="open = !open">{{ open ? t("deploymentCard.hide_details") : t("deploymentCard.details") }}</Button>
  </article>
</template>

<style scoped>
.env { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 14px 16px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); }
.env.selected { border: 2px solid var(--mt-accent); padding: 13px 15px; box-shadow: 0 4px 14px color-mix(in srgb, var(--mt-accent) 14%, transparent); }
.head { display: flex; align-items: center; gap: 10px; }
.key { font-family: var(--mt-mono); font-size: 15px; font-weight: 500; letter-spacing: 0.02em; }
.spacer { flex: 1; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.metrics { display: flex; align-items: flex-end; gap: 16px; }
.metric { display: flex; flex-direction: column; gap: 3px; line-height: 1.1; }
.metric.end { margin-left: auto; text-align: right; }
.metric span { font-size: 11px; color: var(--mt-faint); }
.big { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.mid { font-size: 18px; font-weight: 800; letter-spacing: -0.01em; }
.ident { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ver { flex: none; padding: 2px 8px; border-radius: var(--mt-radius-xs); background: var(--mt-bg); color: var(--mt-muted); font-family: var(--mt-mono); font-size: 11.5px; }
.api { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mt-mono); font-size: 11.5px; color: var(--mt-muted); }
.rows { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 7px 10px; margin: 0; padding-top: 8px; border-top: 1px solid var(--mt-line-2); font-size: 12px; }
dt { color: var(--mt-muted); }
.deployed { display: flex; align-items: center; gap: 8px; }
.muted { color: var(--mt-muted); }
dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
dd.mono { font-family: var(--mt-mono); font-size: 11.5px; }
.foot { display: flex; align-items: center; gap: 10px; padding: 11px 0 0; font: inherit; font-weight: 700; color: var(--mt-ink); background: none; border: none; border-top: 1px solid var(--mt-line-2); cursor: pointer; text-align: left; }
.foot:hover .who { text-decoration: underline; }
.grow { flex: 1; }
.more { align-self: flex-start; margin-top: -4px; }
</style>
