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
const { canManage, canGovern, canManagePeople } = useAssistantAccess(() => props.experimentId);

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
      <button v-if="canManage && card.data.value" type="button" class="ghost" @click="editing = true">Edit</button>
    </PageHeader>

    <ErrorBanner v-if="card.error.value" :error="card.error.value" @retry="card.run()" />
    <div v-else-if="!card.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>

    <template v-else>
      <section class="intro">
        <span class="avatar" aria-hidden="true">{{ initials(card.data.value.name) }}</span>
        <div class="intro-main">
          <p class="desc">{{ card.data.value.description || "No description yet." }}</p>
          <p class="facts">
            <span>Owner <b>{{ card.data.value.owner?.name ?? card.data.value.owner?.email ?? "nobody yet" }}</b></span>
            <span>Traces service <b class="mono">{{ card.data.value.serviceName }}</b></span>
            <router-link :to="{ name: 'overview', params: { experimentId } }" class="traces">Open traces →</router-link>
          </p>
          <div class="people" data-testid="people">
            <div class="faces">
              <PersonAvatar v-for="m in card.data.value.members.preview" :key="m.userId" :name="m.name" :email="m.email" :image="m.image" :size="28" class="face" :class="m.role" />
              <span v-if="card.data.value.members.total > card.data.value.members.preview.length" class="face more">+{{ card.data.value.members.total - card.data.value.members.preview.length }}</span>
            </div>
            <span v-if="card.data.value.members.total === 0" class="muted">Nobody yet.</span>
            <span v-else class="names">{{ card.data.value.members.preview.map((m) => `${personLabel(m)} (${ROLE_LABEL[m.role] ?? m.role})`).join(", ") }}</span>
            <router-link v-if="canManagePeople" :to="{ name: 'admin-experiment', params: { expId: experimentId }, query: { tab: 'members' } }" class="traces" data-testid="manage-people">Manage people →</router-link>
          </div>
        </div>
      </section>

      <TabBar :tabs="tabs" :model-value="tab" @update:model-value="selectTab" />
      <AssistantEnvironments v-if="tab === 'environments'" :card="card.data.value" :can-manage="canManage" :can-govern="canGovern" :now-ms="nowMs" @changed="card.run()" />
      <AssistantConnections v-else :card="card.data.value" :can-manage="canManage" :can-govern="canGovern" :now-ms="nowMs" @changed="card.run()" />
    </template>

    <EditAssistantModal v-if="editing && card.data.value" :card="card.data.value" @close="editing = false" @saved="card.run()" />
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 24px 24px; background: var(--mt-bg); }
.loading { display: flex; justify-content: center; padding: 60px; }
.ghost { height: 32px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-text); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.intro { display: flex; align-items: flex-start; gap: 14px; }
.avatar { width: 44px; height: 44px; flex: none; display: grid; place-items: center; border-radius: 10px; font-weight: 800; font-size: 15px; background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.intro-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.desc { margin: 0; font-size: 13px; max-width: 72ch; }
.facts { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0; font-size: 12px; color: var(--mt-muted); }
.facts b { color: var(--mt-ink); font-weight: 700; }
.mono { font-family: var(--mt-mono); font-weight: 500; }
.people { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; margin-top: 4px; font-size: 12px; color: var(--mt-muted); }
.faces { display: flex; align-items: center; padding-right: 6px; }
.face { margin-right: -6px; }
.face.business { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.face.more { width: 28px; height: 28px; box-sizing: border-box; display: grid; place-items: center; border: 2px solid var(--mt-card); border-radius: 50%; font-size: 9.5px; font-weight: 800; background: var(--mt-soft); color: var(--mt-muted); }
.names { color: var(--mt-ink); }
.traces { font-weight: 700; color: var(--mt-accent-text); text-decoration: none; }
.traces:hover { text-decoration: underline; }
</style>
