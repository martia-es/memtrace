<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AssistantCardDto, DeploymentSummaryDto, EnvironmentDto } from "@contract";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { formatRelativeTime } from "../../i18n/format";
import { canDeploy as canDeployTo, productionDeployment } from "@/domain/assistants";
import { canTalkTo } from "@/domain/chat-dock";
import { useChatDock } from "../../composables/useChatDock";
import EmptyState from "../EmptyState.vue";
import AccessPanel from "./AccessPanel.vue";
import DeploymentCard from "./DeploymentCard.vue";
import DeploymentModal from "./DeploymentModal.vue";
import DeployModal from "./DeployModal.vue";
import Button from "../Button.vue";
import { t } from "../../i18n";

/** Pestaña «Environments» de la ficha: un despliegue por entorno y, debajo, quién puede llamar al seleccionado (ADR-053). */
const props = defineProps<{ card: AssistantCardDto; canManage: boolean; canGovern: boolean; canDeploy?: boolean; nowMs: number }>();
const emit = defineEmits<{ changed: [] }>();

const api = useAssistantApi();
const environments = useAsync((signal) => api.listEnvironments(props.card.experimentId, signal));
onMounted(() => void environments.run());

const selectedId = ref<string | null>(null);
const selected = computed<DeploymentSummaryDto | null>(
  () => props.card.deployments.find((d) => d.id === selectedId.value) ?? productionDeployment(props.card) ?? props.card.deployments[0] ?? null,
);
const free = computed<EnvironmentDto[]>(() => (environments.data.value ?? []).filter((e) => !props.card.deployments.some((d) => d.environment.key === e.key)));
const modal = ref<{ deployment?: DeploymentSummaryDto } | null>(null);
const deploying = ref<DeploymentSummaryDto | null>(null);
const deployTick = ref(0);
const chatDock = useChatDock();
const talk = (d: DeploymentSummaryDto) =>
  chatDock.open({ experimentId: props.card.experimentId, deploymentId: d.id, agentName: props.card.name, environmentLabel: d.environment.label });
const lastCheck = computed(() => props.card.deployments.map((d) => d.healthCheckedAt).filter((v): v is string => v !== null).sort().at(-1) ?? null);
</script>

<template>
  <div class="envs">
    <div class="bar">
      <span v-if="lastCheck" class="muted">{{ t("assistantEnvironments.last_health_check_when", { when: formatRelativeTime(lastCheck, nowMs) }) }}</span>
      <div class="spacer" />
      <Button variant="link" v-if="canManage && free.length > 0" class="add" @click="modal = {}">{{ t("assistantEnvironments.add_deployment") }}</Button>
    </div>
    <EmptyState v-if="card.deployments.length === 0" icon="cloud_off" :title="t('assistantEnvironments.no_deployments_yet')">
      {{ t("assistantEnvironments.add_the_api_of_this_assistant") }}
      <section class="setup" data-testid="setup-guide">
        <h3>{{ t("assistantEnvironments.set_up") }}</h3>
        <ol>
          <li><strong>{{ t("assistantEnvironments.add_a_deployment") }}</strong>{{ " " + t("assistantEnvironments.pick_an_environment_dev_pre_pro") }}</li>
          <li><strong>{{ t("assistantEnvironments.expose_a_health_endpoint") }}</strong>{{ " " + t("assistantEnvironments.memtrace_calls") + " " }}<code>/health</code>{{ " " + t("assistantEnvironments.on_that_url_or_the_one") }}</li>
          <li><strong>{{ t("assistantEnvironments.optional") }}</strong>{{ " " + t("assistantEnvironments.use") + " " }}<em>{{ t("assistantEnvironments.edit_details") }}</em>{{ " " + t("assistantEnvironments.to_link_the_repository_so_you") }}</li>
        </ol>
        <Button variant="primary" v-if="canManage && free.length > 0" class="primary" data-testid="setup-add" @click="modal = {}">{{ t("assistantEnvironments.add_your_first_deployment") }}</Button>
        <p v-else-if="!canManage" class="muted">{{ t("assistantEnvironments.ask_someone_with_permission_to_manage") }}</p>
      </section>
    </EmptyState>
    <template v-else>
      <div class="grid">
        <DeploymentCard
          v-for="d in card.deployments"
          :key="d.id"
          :experiment-id="card.experimentId"
          :deployment="d"
          :selected="selected?.id === d.id"
          :can-manage="canManage"
          :now-ms="nowMs"
          :chat-path="card.chat?.path ?? null"
          :talkable="canTalkTo(card, d)"
          :deployable="props.canDeploy === true && canDeployTo(card, d)"
          :refresh-key="deployTick"
          :repo="card.repo"
          @deploy="deploying = d"
          @talk="talk(d)"
          @select="selectedId = d.id"
          @edit="modal = { deployment: d }"
          @checked="emit('changed')"
        />
      </div>
      <AccessPanel v-if="selected" :experiment-id="card.experimentId" :deployment="selected" :can-govern="canGovern" :now-ms="nowMs" @changed="emit('changed')" />
    </template>
    <DeployModal v-if="deploying" :experiment-id="card.experimentId" :deployment="deploying" :repo="card.repo" :can-bypass="canGovern" @close="deploying = null" @deployed="deployTick++" />
    <DeploymentModal v-if="modal" :experiment-id="card.experimentId" :deployment="modal.deployment" :environments="free" @close="modal = null" @saved="emit('changed')" />
  </div>
</template>

<style scoped>
.envs { display: flex; flex-direction: column; gap: 12px; }
.bar { display: flex; align-items: center; gap: 10px; }
.spacer { flex: 1; }
.muted { font-size: 12px; color: var(--mt-muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }

.setup { max-width: 520px; margin: 18px auto 0; padding: 14px 18px; text-align: left; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius); color: var(--mt-ink); }
.setup h3 { margin: 0 0 8px; font-size: 14px; }
.setup ol { margin: 0 0 12px; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.45; }
.setup code { font-family: var(--mt-mono); font-size: 12px; }



</style>
