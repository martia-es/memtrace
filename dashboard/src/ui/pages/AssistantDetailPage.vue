<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAsync } from "../composables/useAsync";
import { useAssistantAccess } from "../composables/useAssistantAccess";
import { useAssistantApi } from "../composables/useAssistantApi";
import { ROLE_LABEL, headline, personLabel } from "@/domain/assistants";
import PersonAvatar from "../components/assistants/PersonAvatar.vue";
import AssistantConnections from "../components/assistants/AssistantConnections.vue";
import AssistantEnvironments from "../components/assistants/AssistantEnvironments.vue";
import EditAssistantModal from "../components/assistants/EditAssistantModal.vue";
import CiSetup from "../components/assistants/CiSetup.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusChip from "../components/StatusChip.vue";
import TabBar from "../components/TabBar.vue";
import { initials } from "@/domain/assistants";

/** Ficha de un asistente (ADR-053): entornos con su salud y accesos, y conexiones declaradas y observadas. */
const props = defineProps<{ experimentId: string }>();
const REFRESH_MS = 30_000;

const route = useRoute();
const router = useRouter();
const api = useAssistantApi();
const { canManage, canGovern, canDeploy, canManagePeople } = useAssistantAccess(() => props.experimentId);

const card = useAsync((signal) => api.getAssistant(props.experimentId, signal));
void card.run();
const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now();
    void card.run();
  }, REFRESH_MS);
});
onBeforeUnmount(() => clearInterval(timer));

const tab = computed(() => (route.query.tab === "connections" ? "connections" : "environments"));
const tabs = computed(() => [
  { id: "environments", label: "Environments", count: card.data.value?.deployments.length },
  { id: "connections", label: "Connections", count: card.data.value ? card.data.value.connectionCounts.mcpServers + card.data.value.connectionCounts.tools + card.data.value.connectionCounts.agents : undefined },
]);
function selectTab(id: string) {
  void router.replace({ query: { ...route.query, tab: id } });
}
const head = computed(() => (card.data.value ? headline(card.data.value) : null));
const editing = ref(false);
</script>

<template>
  <div class="page">
    <PageHeader
      :crumbs="[{ label: 'Assistants', to: { name: 'assistants' } }, { label: card.data.value?.name ?? '…' }]"
      icon="M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 14h.01M15 14h.01"
      :title="card.data.value?.name ?? 'Assistant'"
    >
      <StatusChip v-if="head" :tone="head.tone" :label="head.label" />
    </PageHeader>

    <ErrorBanner v-if="card.error.value" :error="card.error.value" @retry="card.run()" />
    <div v-else-if="!card.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-else>
      <section class="intro">
        <span class="avatar" aria-hidden="true">{{ initials(card.data.value.name) }}</span>
        <div class="intro-main">
          <p class="desc">{{ card.data.value.description || "No description yet." }}</p>
          <dl class="facts">
            <div class="fact">
              <dt>Owner</dt>
              <dd v-if="card.data.value.owner" class="owner">
                <PersonAvatar :name="card.data.value.owner.name" :email="card.data.value.owner.email" :image="card.data.value.owner.image" :size="22" />{{ card.data.value.owner.name ?? card.data.value.owner.email }}
              </dd>
              <dd v-else>Nobody yet</dd>
            </div>
            <div class="fact">
              <dt>Traces service</dt>
              <dd>
                <span class="mono">{{ card.data.value.serviceName }}</span>
                <router-link :to="{ name: 'overview', params: { experimentId } }" class="traces">Open traces →</router-link>
              </dd>
            </div>
            <div v-if="card.data.value.repo" class="fact" data-testid="repo">
              <dt>Repository</dt>
              <dd><a :href="card.data.value.repo.url" target="_blank" rel="noopener noreferrer" class="mono">{{ card.data.value.repo.url.replace(/^https:\/\//, "") }}</a></dd>
            </div>
            <div class="fact people" data-testid="people">
              <dt>People</dt>
              <dd>
                <span v-if="card.data.value.members.total === 0" class="muted">Nobody yet.</span>
                <ul v-else class="members">
                  <li v-for="m in card.data.value.members.preview" :key="m.userId">
                    <PersonAvatar :name="m.name" :email="m.email" :image="m.image" :size="24" :class="m.role" />
                    <span>{{ personLabel(m) }} <small>{{ ROLE_LABEL[m.role] ?? m.role }}</small></span>
                  </li>
                  <li v-if="card.data.value.members.total > card.data.value.members.preview.length" class="more">+{{ card.data.value.members.total - card.data.value.members.preview.length }} more</li>
                </ul>
                <router-link v-if="canManagePeople" :to="{ name: 'admin-experiment', params: { expId: experimentId }, query: { tab: 'members' } }" class="traces" data-testid="manage-people">Manage people →</router-link>
              </dd>
            </div>
          </dl>
        </div>
        <button v-if="canManage" type="button" class="ghost" data-testid="edit-assistant" @click="editing = true">Edit details</button>
      </section>

      <CiSetup :repo="card.data.value.repo" />

      <TabBar :tabs="tabs" :model-value="tab" @update:model-value="selectTab" />
      <AssistantEnvironments v-if="tab === 'environments'" :card="card.data.value" :can-manage="canManage" :can-govern="canGovern" :can-deploy="canDeploy" :now-ms="nowMs" @changed="card.run()" />
      <AssistantConnections v-else :card="card.data.value" :can-manage="canManage" :can-govern="canGovern" :now-ms="nowMs" @changed="card.run()" />
    </template>

    <EditAssistantModal v-if="editing && card.data.value" :card="card.data.value" @close="editing = false" @saved="card.run()" />
  </div>
</template>

<style scoped>
.owner { display: inline-flex; align-items: center; gap: 8px; }
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 24px 24px; background: var(--mt-bg); }
.loading { display: flex; justify-content: center; padding: 60px; }
.ghost { height: 32px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-text); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.intro { display: flex; align-items: flex-start; gap: 16px; padding: 16px 18px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius); }
.avatar { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: 10px; font-weight: 800; font-size: 15px; background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.intro-main { flex: 1; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.desc { margin: 0; font-size: 14px; line-height: 1.5; max-width: 72ch; }
.facts { display: grid; grid-template-columns: minmax(140px, 200px) minmax(180px, 260px) 1fr; gap: 14px 32px; margin: 0; padding-top: 14px; border-top: 1px solid var(--mt-line); }
.fact { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.fact dt { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--mt-muted); }
.fact dd { margin: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; font-size: 13px; font-weight: 600; color: var(--mt-ink); }
.mono { font-family: var(--mt-mono); font-weight: 500; }
.members { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0; padding: 0; list-style: none; }
.members li { display: flex; align-items: center; gap: 8px; font-weight: 600; }
.members small { font-size: 11px; font-weight: 500; color: var(--mt-muted); }
.members :deep(.business) { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.members .more { color: var(--mt-muted); font-weight: 500; font-size: 12px; }
.muted { color: var(--mt-muted); font-weight: 500; }
@media (max-width: 900px) { .facts { grid-template-columns: 1fr; } }
.traces { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); text-decoration: none; }
.traces:hover { text-decoration: underline; }
</style>
