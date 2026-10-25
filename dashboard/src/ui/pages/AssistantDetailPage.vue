<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAsync } from "../composables/useAsync";
import { useAssistantAccess } from "../composables/useAssistantAccess";
import { useAssistantApi } from "../composables/useAssistantApi";
import { ROLE_LABEL, headline, personLabel } from "@/domain/assistants";
import { RISK_LABEL, RISK_TONE, levelOf } from "@/domain/risk";
import Pill from "../components/Pill.vue";
import PersonAvatar from "../components/assistants/PersonAvatar.vue";
import AssistantConnections from "../components/assistants/AssistantConnections.vue";
import AssistantEnvironments from "../components/assistants/AssistantEnvironments.vue";
import EditAssistantModal from "../components/assistants/EditAssistantModal.vue";
import CiSetup from "../components/assistants/CiSetup.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusChip from "../components/StatusChip.vue";
import { initials } from "@/domain/assistants";
import Button from "../components/Button.vue";
import LoadingState from "../components/LoadingState.vue";
import { t, tp } from "../i18n";

/** Ficha de un asistente (ADR-053): entornos con su salud y accesos, y conexiones declaradas y observadas. */
const props = defineProps<{ experimentId: string }>();
const REFRESH_MS = 30_000;

const route = useRoute();
const api = useAssistantApi();
const { canManage, canGovern, canDeploy, canManagePeople, organizationId } = useAssistantAccess(() => props.experimentId);

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

// una sola vista (ADR-053): los enlaces antiguos con `?tab=connections` bajan a esa sección
const connectionsEl = ref<HTMLElement | null>(null);
watch(
  () => [route.query.tab === "connections", card.data.value !== null] as const,
  async ([wanted, loaded]) => {
    if (!wanted || !loaded) return;
    await nextTick();
    connectionsEl.value?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  },
  { immediate: true },
);
/** lo que necesita a alguien: entornos que no responden y conexiones sin aprobar */
const attention = computed(() => {
  const c = card.data.value;
  if (!c) return [];
  const items: { id: string; text: string; anchor: "environments" | "connections" }[] = [];
  const down = c.deployments.filter((d) => d.healthStatus === "down" || d.healthStatus === "degraded");
  if (down.length > 0) items.push({ id: "health", text: t("assistantDetailPage.environments_not_healthy", { names: down.map((d) => d.environment.label).join(", ") }), anchor: "environments" });
  if (c.connectionCounts.toReview > 0) items.push({ id: "review", text: tp("assistantDetailPage.connections_to_review", c.connectionCounts.toReview), anchor: "connections" });
  return items;
});
const environmentsEl = ref<HTMLElement | null>(null);
const jump = (anchor: "environments" | "connections") => (anchor === "connections" ? connectionsEl : environmentsEl).value?.scrollIntoView?.({ behavior: "smooth", block: "start" });
const head = computed(() => (card.data.value ? headline(card.data.value) : null));
const editing = ref(false);
</script>

<template>
  <div class="page">
    <PageHeader
      :crumbs="[{ label: 'Assistants', to: { name: 'assistants' } }, { label: card.data.value?.name ?? '…' }]"
      icon="M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 14h.01M15 14h.01"
      :title="card.data.value?.name ?? t('assistantDetailPage.assistant')"
    >
      <StatusChip v-if="head" :tone="head.tone" :label="head.label" />
    </PageHeader>

    <ErrorBanner v-if="card.error.value" :error="card.error.value" @retry="card.run()" />
    <LoadingState v-else-if="!card.data.value" size="lg" />

    <template v-else>
      <section class="intro">
        <span class="avatar" aria-hidden="true">{{ initials(card.data.value.name) }}</span>
        <div class="intro-main">
          <p class="desc">{{ card.data.value.description || t("assistantDetailPage.no_description_yet") }}</p>
          <ul class="chips">
            <li class="chip" data-testid="owner">
              <span class="k">{{ t("assistantDetailPage.owner") }}</span>
              <template v-if="card.data.value.owner">
                <PersonAvatar :name="card.data.value.owner.name" :email="card.data.value.owner.email" :image="card.data.value.owner.image" :size="18" /><b>{{ card.data.value.owner.name ?? card.data.value.owner.email }}</b>
              </template>
              <b v-else class="muted">{{ t("assistantDetailPage.nobody_yet") }}</b>
            </li>
            <li class="chip">
              <span class="k">{{ t("assistantDetailPage.traces_service") }}</span>
              <span class="mono">{{ card.data.value.serviceName }}</span>
              <router-link :to="{ name: 'overview', params: { experimentId } }" class="traces">{{ t("assistantDetailPage.open_traces") }}</router-link>
            </li>
            <li v-if="card.data.value.repo" class="chip" data-testid="repo">
              <span class="k">{{ t("assistantDetailPage.repository") }}</span>
              <a :href="card.data.value.repo.url" target="_blank" rel="noopener noreferrer" class="mono">{{ card.data.value.repo.url.replace(/^https:\/\//, "") }}</a>
            </li>
            <li class="chip" data-testid="risk">
              <span class="k">{{ t("assistantDetailPage.risk") }}</span>
              <Pill :tone="RISK_TONE[levelOf(card.data.value.risk)]">{{ RISK_LABEL[levelOf(card.data.value.risk)] }}</Pill>
              <router-link v-if="organizationId" :to="{ name: 'admin-organization', params: { organizationId }, query: { tab: 'risk' } }" class="traces" data-testid="manage-risk">{{ t("assistantDetailPage.manage_in_settings") }}</router-link>
            </li>
            <li class="chip people" data-testid="people">
              <span class="k">{{ t("assistantDetailPage.people") }}</span>
              <span v-if="card.data.value.members.total === 0" class="muted">{{ t("assistantDetailPage.nobody_yet2") }}</span>
              <template v-else>
                <span v-for="m in card.data.value.members.preview" :key="m.userId" class="member">
                  <PersonAvatar :name="m.name" :email="m.email" :image="m.image" :size="18" :class="m.role" />
                  <b>{{ personLabel(m) }}</b> <small>{{ ROLE_LABEL[m.role] ?? m.role }}</small>
                </span>
                <span v-if="card.data.value.members.total > card.data.value.members.preview.length" class="muted">{{ t("assistantDetailPage.more", { count: card.data.value.members.total - card.data.value.members.preview.length }) }}</span>
              </template>
              <router-link v-if="canManagePeople" :to="{ name: 'admin-experiment', params: { expId: experimentId }, query: { tab: 'members' } }" class="traces" data-testid="manage-people">{{ t("assistantDetailPage.manage_people") }}</router-link>
            </li>
          </ul>
        </div>
        <Button v-if="canManage" data-testid="edit-assistant" @click="editing = true">{{ t("assistantDetailPage.edit_details") }}</Button>
      </section>

      <CiSetup :repo="card.data.value.repo" />

      <section v-if="attention.length > 0" class="attention" role="status" data-testid="attention-strip">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        <span class="items">
          <span v-for="a in attention" :key="a.id" :data-testid="`attention-${a.id}`">{{ a.text }}</span>
        </span>
        <Button v-for="a in attention" :key="a.id" variant="link" class="jump" @click="jump(a.anchor)">{{ a.anchor === "connections" ? t("assistantDetailPage.review_connections") : t("assistantDetailPage.see_environments") }}</Button>
      </section>

      <section ref="environmentsEl" class="section" data-testid="section-environments">
        <header class="section-head">
          <h2>{{ t("assistantDetailPage.environments") }}</h2>
          <span class="count">{{ card.data.value.deployments.length }}</span>
        </header>
        <AssistantEnvironments :card="card.data.value" :can-manage="canManage" :can-govern="canGovern" :can-deploy="canDeploy" :now-ms="nowMs" @changed="card.run()" />
      </section>

      <section ref="connectionsEl" class="section" data-testid="section-connections">
        <header class="section-head">
          <h2>{{ t("assistantDetailPage.connections") }}</h2>
          <span class="count">{{ card.data.value.connectionCounts.mcpServers + card.data.value.connectionCounts.tools + card.data.value.connectionCounts.agents }}</span>
        </header>
        <AssistantConnections :card="card.data.value" :can-manage="canManage" :can-govern="canGovern" :now-ms="nowMs" @changed="card.run()" />
      </section>
    </template>

    <EditAssistantModal v-if="editing && card.data.value" :card="card.data.value" @close="editing = false" @saved="card.run()" />
  </div>
</template>

<style scoped>
.owner { display: inline-flex; align-items: center; gap: 8px; }
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 24px 24px; background: var(--mt-bg); }
.ghost { height: 32px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-text); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.intro { display: flex; align-items: center; gap: 14px; padding: 14px 16px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius); }
.avatar { width: 40px; height: 40px; flex: none; display: grid; place-items: center; border-radius: 8px; font-weight: 800; font-size: 15px; background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.intro-main { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.desc { margin: 0; font-size: 13px; line-height: 1.5; max-width: 72ch; color: var(--mt-muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.chip { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-height: 26px; padding: 2px 10px; border-radius: 14px; background: var(--mt-bg); font-size: 12.5px; }
.chip .k { color: var(--mt-muted); }
.chip b { font-weight: 700; }
.mono { font-family: var(--mt-mono); font-weight: 500; font-size: 12px; }
.member { display: inline-flex; align-items: center; gap: 6px; }
.member small { font-size: 11px; font-weight: 500; color: var(--mt-muted); }
.member :deep(.business) { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.muted { color: var(--mt-muted); font-weight: 500; }
.traces { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); text-decoration: none; }
.traces:hover { text-decoration: underline; }
.attention { display: flex; align-items: center; gap: 12px; padding: 9px 16px; border-radius: var(--mt-radius); background: var(--mt-warn-bg); color: var(--mt-warn-ink); border: 1px solid color-mix(in srgb, var(--mt-warn) 40%, transparent); font-weight: 600; }
.attention .items { flex: 1; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.jump { font: inherit; font-size: 12.5px; font-weight: 700; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
.jump:hover { text-decoration: underline; }
.section { display: flex; flex-direction: column; gap: 10px; scroll-margin-top: 12px; }
.section-head { display: flex; align-items: center; gap: 8px; }
.section-head h2 { margin: 0; font-size: 15px; font-weight: 800; }
.count { padding: 0 6px; border-radius: 4px; background: var(--mt-bg); color: var(--mt-muted); font-size: 11px; font-weight: 800; line-height: 18px; border: 1px solid var(--mt-line); }
</style>
