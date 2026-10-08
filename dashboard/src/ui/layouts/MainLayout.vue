<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFilters } from "../composables/useFilters";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import { applyOrganizationTheme } from "../composables/useOrganizationTheme";
import { setKnownThemes } from "../composables/useAssistantDisplay";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import ExperimentSelect from "../components/ExperimentSelect.vue";
import { hasPermission } from "../composables/usePermissions";
import UserMenu from "../components/UserMenu.vue";
import AssistantChatDock from "../components/AssistantChatDock.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import { liveSeconds, liveUpdatedAt, requestRefresh, setRefreshSeconds } from "../composables/useLiveRefresh";
import { useTopbar } from "../composables/useTopbar";

const route = useRoute();
const router = useRouter();
const f = useFilters();
const { shared } = f;
const identityApi = useIdentityApi();
const isCollapsed = ref(false);
const experiments = useAsync((signal) => identityApi.listExperiments(signal));
void experiments.run().then(() => setKnownThemes(experiments.data.value ?? []));
// el catálogo de asistentes (ADR-053) pide `governance:read` en alguna organización
const organizations = useAsync((signal) => identityApi.listOrganizations(signal));
void organizations.run();
const canSeeAssistants = computed(() => (organizations.data.value ?? []).some((o) => hasPermission(o, "governance:read")));

const OTLP_ENDPOINT = import.meta.env.VITE_OTLP_ENDPOINT ?? "http://localhost:4318";

// Navegación de 5 secciones (ADR-048) con submenús en vez de pestañas dentro de cada página (ADR-059).
// Cada hijo es una ruta con su propia URL; "sections" son los meta.section que lo dejan activo. Un grupo con un
// solo hijo se pinta como un item plano.
interface NavChild { name: string; label: string; sections: readonly string[] }
interface NavGroup { id: string; label: string; icon: string; children: readonly NavChild[] }
const NAV: readonly NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
    children: [
      { name: "overview", label: "Summary", sections: ["overview"] },
      { name: "overview-compare", label: "Compare", sections: ["compare"] },
      { name: "overview-charts", label: "Custom charts", sections: ["charts"] },
      { name: "overview-reports", label: "Reports", sections: ["reports"] },
    ],
  },
  { id: "conversations", label: "Conversations", icon: "M4 5h16v11H9l-5 4z", children: [{ name: "conversations", label: "Conversations", sections: ["conversations"] }] },
  {
    id: "review",
    label: "Review",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    children: [
      { name: "annotation-queues", label: "My inbox", sections: ["review-inbox"] },
      { name: "annotation-queues-all", label: "All queues", sections: ["review-queues"] },
      { name: "annotation-queues-archived", label: "Archived", sections: ["review-archived"] },
    ],
  },
  { id: "prompts", label: "Prompts", icon: "M4 6h16M4 12h16M4 18h10", children: [{ name: "prompts", label: "Prompts", sections: ["prompts"] }] },
  {
    id: "evaluations",
    label: "Evaluations",
    icon: "M3 3v18h18M7 14l4-4 3 3 5-6",
    children: [
      { name: "runs", label: "Runs", sections: ["runs"] },
      { name: "datasets", label: "Datasets", sections: ["datasets"] },
      { name: "trends", label: "Trends", sections: ["trends"] },
    ],
  },
];
const CHEVRON = "M6 9l6 6 6-6";
// gestión de organizaciones/experimentos/API keys (ADR-013): no cuelga de :experimentId
const ADMIN_ICON = "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6z";
// catálogo de precios por modelo (ADR-025): global, no cuelga de :experimentId
const PRICING_ICON = "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6";
// catálogo de asistentes (ADR-053)
const ASSISTANTS_ICON = "M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 14h.01M15 14h.01";

// revisiones pendientes del usuario: el badge de "Review" lleva a la bandeja (ADR-048)
const api = useTraceApi();
const queues = useAsync((signal) => api.listAnnotationQueues(false, signal));
const pendingReviews = computed(() => (queues.data.value?.items ?? []).filter((q) => q.isReviewer).reduce((n, q) => n + q.progress.pending, 0));
watch(
  () => route.params.experimentId,
  (id) => {
    if (typeof id === "string" && navCanRead.value) void queues.run();
  },
  { immediate: true },
);

// every route rendered inside MainLayout declares its own meta.section explicitly
const section = computed(() => route.meta.section as string | undefined);
const isActive = (sections: readonly string[]) => sections.includes(section.value ?? "");
const groupActive = (g: NavGroup) => g.children.some((c) => isActive(c.sections));
const isLeaf = (g: NavGroup) => g.children.length === 1;
// con el sidebar plegado solo hay iconos: el grupo lleva a su primera página
const navTo = (c: NavChild) => ({ name: c.name, params: { experimentId: navExperimentId.value as string }, query: shared.value });
// design screens (conversations, trace) manage their own scroll; the rest go in a card that scrolls
const framed = computed(() => route.meta.framed === true);
const experimentOptions = computed(() => experiments.data.value ?? []);
const currentExperimentId = computed(() => (route.params.experimentId as string | undefined) ?? null);
const currentExperiment = computed(() => experimentOptions.value.find((e) => e.id === currentExperimentId.value) ?? null);
provide(CURRENT_EXPERIMENT, currentExperiment);

// tema de la organización dueña del experimento actual (ADR-019): sobrescribe accent/radius en :root
watch(currentExperiment, (experiment) => applyOrganizationTheme(experiment?.organizationTheme ?? null), { immediate: true });

// en /admin no hay :experimentId en la ruta, pero Conversations/Metrics necesitan uno para su link:
// se cae al último usado (o al primero disponible) para no perder el contexto al volver.
const navExperimentId = computed(
  () => currentExperimentId.value ?? localStorage.getItem("memtrace:lastExperimentId") ?? experimentOptions.value[0]?.id ?? null,
);

// quien no tiene `experiment:read` (p. ej. un org_admin sin rol de trabajo) solo ve Admin (ADR-052)
const navCanRead = computed(() => hasPermission(experimentOptions.value.find((e) => e.id === navExperimentId.value), "experiment:read"));

// topbar global (ADR-058): las páginas teletransportan aquí su breadcrumb y sus filtros
const { leftEl, rightEl, leftCount } = useTopbar();
const topbarLeft = ref<HTMLElement | null>(null);
const topbarRight = ref<HTMLElement | null>(null);
watch([topbarLeft, topbarRight], ([l, r]) => ((leftEl.value = l), (rightEl.value = r)));
onBeforeUnmount(() => ((leftEl.value = null), (rightEl.value = null)));

function switchExperiment(experimentId: string | null) {
  if (!experimentId) return;
  void router.push({ name: "overview", params: { experimentId } });
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-header">
        <router-link :to="navExperimentId ? { name: 'overview', params: { experimentId: navExperimentId }, query: shared } : { name: 'admin' }" class="brand" aria-label="MemTrace">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4.5" rx="2.25" fill="var(--mt-brand)" /><rect x="6" y="9" width="15" height="4.5" rx="2.25" fill="var(--mt-highlight)" /><rect x="3" y="15" width="9" height="4.5" rx="2.25" fill="var(--mt-brand)" opacity="0.5" />
          </svg>
          <span v-if="!isCollapsed">MemTrace</span>
        </router-link>
        <button class="collapse-btn" :aria-label="isCollapsed ? 'Expand menu' : 'Collapse menu'" @click="isCollapsed = !isCollapsed">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="isCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
          </svg>
        </button>
      </div>
      <ExperimentSelect
        v-if="!isCollapsed"
        :model-value="currentExperimentId"
        :options="experimentOptions"
        :loading="experiments.loading.value"
        @update:model-value="switchExperiment"
      />
      <nav aria-label="Main" class="nav">
        <template v-if="navExperimentId && navCanRead">
          <template v-for="g in NAV" :key="g.id">
            <router-link
              :to="navTo(g.children[0]!)"
              class="nav-item"
              :class="{ active: isLeaf(g) && groupActive(g), open: !isLeaf(g) && groupActive(g) }"
              :aria-current="isLeaf(g) && groupActive(g) ? 'page' : undefined"
              :aria-expanded="isLeaf(g) ? undefined : groupActive(g)"
              :title="isCollapsed ? g.label : undefined"
              :data-testid="`nav-${g.id}`"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="g.icon" /></svg>
              <span v-if="!isCollapsed" class="nav-label">{{ g.label }}</span>
              <span v-if="!isCollapsed && g.id === 'review' && pendingReviews > 0 && !groupActive(g)" class="nav-badge" data-testid="pending-reviews">{{ pendingReviews }}</span>
              <svg v-if="!isCollapsed && !isLeaf(g)" class="nav-chevron" :class="{ expanded: groupActive(g) }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="CHEVRON" /></svg>
            </router-link>
            <div v-if="!isCollapsed && !isLeaf(g) && groupActive(g)" class="nav-sub" role="group" :aria-label="g.label">
              <router-link
                v-for="c in g.children"
                :key="c.name"
                :to="navTo(c)"
                class="nav-subitem"
                :class="{ active: isActive(c.sections) }"
                :aria-current="isActive(c.sections) ? 'page' : undefined"
              >
                <span class="nav-label">{{ c.label }}</span>
                <span v-if="g.id === 'review' && c.name === 'annotation-queues' && pendingReviews > 0" class="nav-badge" data-testid="pending-reviews">{{ pendingReviews }}</span>
              </router-link>
            </div>
          </template>
        </template>
        <router-link
          v-if="canSeeAssistants"
          :to="{ name: 'assistants' }"
          class="nav-item"
          :class="{ active: route.meta.section === 'assistants' }"
          :aria-current="route.meta.section === 'assistants' ? 'page' : undefined"
          :title="isCollapsed ? 'Assistants' : undefined"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ASSISTANTS_ICON" /></svg>
          <span v-if="!isCollapsed" class="nav-label">Assistants</span>
        </router-link>
        <router-link
          :to="{ name: 'model-pricing' }"
          class="nav-item"
          :class="{ active: route.name === 'model-pricing' }"
          :aria-current="route.name === 'model-pricing' ? 'page' : undefined"
          :title="isCollapsed ? 'Costs' : undefined"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="PRICING_ICON" /></svg>
          <span v-if="!isCollapsed" class="nav-label">Costs</span>
        </router-link>
      </nav>
      <div class="sidebar-foot">
        <router-link
          :to="{ name: 'admin' }"
          class="nav-item"
          :class="{ active: route.meta.section === 'admin' }"
          :aria-current="route.meta.section === 'admin' ? 'page' : undefined"
          :title="isCollapsed ? 'Settings' : undefined"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ADMIN_ICON" /></svg>
          <span v-if="!isCollapsed" class="nav-label">Settings</span>
        </router-link>
        <UserMenu :collapsed="isCollapsed" />
      </div>
    </aside>
    <div class="main-col">
      <header class="topbar">
        <div ref="topbarLeft" class="topbar-left">
          <span v-if="leftCount === 0" class="topbar-title">{{ route.meta.title }}</span>
        </div>
        <div ref="topbarRight" class="topbar-right" />
        <div v-if="currentExperimentId && navCanRead" class="topbar-filters">
          <FilterBar :range="f.range.value" :custom="f.customRange.value" @update:range="f.setRange" @update:custom="f.setCustomRange" />
          <LiveControl :seconds="liveSeconds" :updated-at="liveUpdatedAt" @update:seconds="setRefreshSeconds" @refresh="requestRefresh" />
        </div>
      </header>
      <main class="content" :class="{ scroll: !framed }">
        <router-view v-if="framed" />
        <q-layout v-else view="hHh lpR fFf" container class="layout">
          <q-page-container><router-view /></q-page-container>
        </q-layout>
      </main>
    </div>
    <AssistantChatDock />
  </div>
</template>

<style scoped>
.shell {
  box-sizing: border-box;
  display: flex;
  height: 100vh;
  min-height: 640px;
  font-size: 13px;
  background: var(--mt-bg);
}
.sidebar {
  width: 220px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 0 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--mt-card);
  border-right: 1px solid var(--mt-line);
  transition: width 0.3s ease-out;
}
.sidebar.collapsed {
  width: 64px;
  padding: 0 8px 10px;
}
.sidebar.collapsed .sidebar-header {
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  height: auto;
  padding: 10px 0;
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 52px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 6px;
  color: inherit;
  text-decoration: none;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.02em;
  flex: 1;
  min-width: 0;
}
.sidebar.collapsed .brand {
  justify-content: center;
  padding: 0;
  flex: 0;
}
.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
  border-radius: var(--mt-radius-sm);
}
.collapse-btn:hover {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 10px;
  border-radius: var(--mt-radius-sm);
  color: var(--mt-muted);
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-label {
  flex: 1;
}
.nav-badge {
  padding: 1px 6px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-highlight-soft);
  color: var(--mt-highlight-ink);
  font-size: 11px;
  font-weight: 700;
}
.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 0 6px;
  gap: 0;
}
.nav-item:hover {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.nav-item.active {
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
/* grupo con submenú abierto: el color lo lleva el hijo activo, no el padre */
.nav-item.open {
  color: var(--mt-ink);
}
.nav-chevron {
  flex-shrink: 0;
  opacity: 0.7;
  transform: rotate(-90deg);
  transition: transform 0.15s ease;
}
.nav-chevron.expanded {
  transform: none;
}
.nav-sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 4px;
}
.nav-subitem {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px 0 36px;
  border-radius: var(--mt-radius-sm);
  color: var(--mt-muted);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s ease, color 0.15s ease;
}
.nav-subitem:hover {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.nav-subitem.active {
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
  font-weight: 700;
}
.sidebar-foot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--mt-line);
}
.main-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  flex: none;
  box-sizing: border-box;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  background: var(--mt-card);
  border-bottom: 1px solid var(--mt-line);
}
.topbar-left {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.topbar-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.topbar-filters,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--mt-bg);
}
.content.scroll {
  overflow: auto;
}
.layout {
  flex: 1;
  min-height: 0;
  background: transparent;
}
</style>
