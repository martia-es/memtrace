<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AssistantCardDto, DeploymentSummaryDto, EnvironmentDto } from "@contract";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { formatRelativeTime } from "@/domain/format";
import { canDeploy as canDeployTo, productionDeployment } from "@/domain/assistants";
import { canTalkTo } from "@/domain/chat-dock";
import { useChatDock } from "../../composables/useChatDock";
import EmptyState from "../EmptyState.vue";
import AccessPanel from "./AccessPanel.vue";
import DeploymentCard from "./DeploymentCard.vue";
import DeploymentModal from "./DeploymentModal.vue";
import DeployModal from "./DeployModal.vue";

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
      <span v-if="lastCheck" class="muted">Last health check {{ formatRelativeTime(lastCheck, nowMs) }}</span>
      <div class="spacer" />
      <button v-if="canManage && free.length > 0" type="button" class="add" @click="modal = {}">Add deployment</button>
    </div>
    <EmptyState v-if="card.deployments.length === 0" icon="cloud_off" title="No deployments yet">
      Add the API of this assistant in each environment to start checking its health.
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
.add { height: 30px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-text); background: transparent; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.add:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
</style>
