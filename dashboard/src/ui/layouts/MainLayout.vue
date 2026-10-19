<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFilters } from "../composables/useFilters";
import { useAsync } from "../composables/useAsync";
import { provideApprovalInbox } from "../composables/useApprovalInbox";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import { applyOrganizationTheme } from "../composables/useOrganizationTheme";
import { setKnownThemes } from "../composables/useAssistantDisplay";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import ExperimentSelect from "../components/ExperimentSelect.vue";
import { hasPermission } from "../composables/usePermissions";
import UserMenu from "../components/UserMenu.vue";
import AlertBell from "../components/AlertBell.vue";
import AssistantChatDock from "../components/AssistantChatDock.vue";
import FilterBar from "../components/FilterBar.vue";
import LiveControl from "../components/LiveControl.vue";
import { liveSeconds, liveUpdatedAt, requestRefresh, setRefreshSeconds } from "../composables/useLiveRefresh";
import { useTopbar } from "../composables/useTopbar";
import Button from "../components/Button.vue";
import LoadingState from "../components/LoadingState.vue";
import { useSettingsNav, withGroupHeaders } from "../composables/useSettingsNav";
import { routeTitle, t, type MessageKey } from "../i18n";

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

// Navegación por intención (ADR-048, ampliado): tres bloques con título (Observe / Watch / Improve) y submenús en vez de
// pestañas dentro de cada página (ADR-059). Cada hijo es una ruta con su propia URL; "sections" son los meta.section que lo
// dejan activo. Un grupo con un solo hijo se pinta como un item plano. "heading" abre un bloque nuevo en ese grupo.
interface NavChild { name: string; label: MessageKey; sections: readonly string[] }
interface NavGroup { id: string; label: MessageKey; icon: string; heading?: MessageKey; children: readonly NavChild[] }
const NAV: readonly NavGroup[] = [
  { id: "overview", label: "nav.overview", heading: "nav.observe", icon: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z", children: [{ name: "overview", label: "nav.overview", sections: ["overview"] }] },
  { id: "conversations", label: "nav.conversations", icon: "M4 5h16v11H9l-5 4z", children: [{ name: "conversations", label: "nav.conversations", sections: ["conversations"] }] },
  {
    id: "analytics",
    label: "nav.analytics",
    icon: "M4 20V10M10 20V4M16 20v-8M22 20H2",
    children: [
      { name: "overview-breakdown", label: "nav.breakdown", sections: ["breakdown"] },
      { name: "overview-compare", label: "nav.compare", sections: ["compare"] },
      { name: "overview-charts", label: "nav.charts", sections: ["charts", "catalog"] },
      { name: "overview-reports", label: "nav.reports", sections: ["reports"] },
    ],
  },
  { id: "monitoring", label: "nav.alertsBudget", heading: "nav.watch", icon: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0", children: [{ name: "alerts", label: "nav.alertsBudget", sections: ["alerts"] }] },
  {
    id: "review",
    label: "nav.review",
    heading: "nav.improve",
    icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    children: [{ name: "annotation-queues", label: "nav.review", sections: ["review"] }],
  },
  { id: "prompts", label: "nav.prompts", icon: "M4 6h16M4 12h16M4 18h10", children: [{ name: "prompts", label: "nav.prompts", sections: ["prompts"] }] },
  {
    id: "evaluations",
    label: "nav.evaluations",
    icon: "M3 3v18h18M7 14l4-4 3 3 5-6",
    children: [
      { name: "datasets", label: "nav.datasets", sections: ["datasets"] },
      { name: "runs", label: "nav.runs", sections: ["runs"] },
      { name: "trends", label: "nav.qualityTrends", sections: ["trends"] },
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
/** Al abrir la app, el guard del router espera a la identidad y a la lista de experimentos antes de resolver la ruta: mientras tanto no hay vista y se muestra el loader. */
const booting = computed(() => !route.name || route.name === "home");
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

// aprobaciones de prompts pendientes de esta persona (ADR-076): el badge de "Prompts" y los avisos de Overview y del listado
const approvalInbox = provideApprovalInbox(
  computed(() => (currentExperiment.value ? { organizationId: currentExperiment.value.organizationId, experimentId: currentExperiment.value.id } : null)),
  navCanRead,
  () => route.fullPath,
);
const pendingApprovals = computed(() => approvalInbox.items.value.length);

// Settings: mientras una página registra sus secciones, el menú lateral las muestra en lugar del principal
const { settingsNav } = useSettingsNav();
const settingsItems = computed(() => withGroupHeaders(settingsNav.value?.sections ?? []));
const settingsActive = computed(() => (typeof route.query.tab === "string" ? route.query.tab : "experiments"));
const backToApp = computed(() =>
  navExperimentId.value && navCanRead.value
    ? { label: t("nav.backToApp"), to: { name: "overview", params: { experimentId: navExperimentId.value }, query: shared.value } }
    : { label: t("nav.allOrganizations"), to: { name: "admin" } },
);

// topbar global (ADR-058): las páginas teletransportan aquí su breadcrumb y sus filtros
const { leftEl, rightEl, leftCount } = useTopbar();
const topbarLeft = ref<HTMLElement | null>(null);
const topbarRight = ref<HTMLElement | null>(null);
watch([topbarLeft, topbarRight], ([l, r]) => ((leftEl.value = l), (rightEl.value = r)));
onBeforeUnmount(() => ((leftEl.value = null), (rightEl.value = null)));

function switchExperiment(experimentId: string | null) {
  if (!experimentId) return;
  // el rango se conserva al cambiar de experimento; el servicio es de cada uno
  const { service: _service, ...query } = shared.value;
  void router.push({ name: "overview", params: { experimentId }, query });
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
        <Button variant="icon" size="sm" class="collapse-btn" :aria-label="isCollapsed ? t('nav.expandMenu') : t('nav.collapseMenu')" @click="isCollapsed = !isCollapsed">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="isCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
          </svg>
        </Button>
      </div>
      <ExperimentSelect
        v-if="!isCollapsed && !settingsNav"
        :model-value="currentExperimentId"
        :options="experimentOptions"
        :loading="experiments.loading.value"
        @update:model-value="switchExperiment"
      />
      <nav v-if="settingsNav" :aria-label="t('common.settings')" class="nav" data-testid="settings-nav">
        <router-link :to="backToApp.to" class="nav-item nav-back" :title="isCollapsed ? backToApp.label : undefined" data-testid="settings-back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          <span v-if="!isCollapsed" class="nav-label">{{ backToApp.label }}</span>
        </router-link>
        <p v-if="!isCollapsed" class="nav-title">{{ settingsNav.title }}</p>
        <template v-for="{ section: s, header } in settingsItems" :key="s.id">
          <p v-if="header && !isCollapsed" class="nav-group">{{ header }}</p>
          <router-link
            :to="{ query: { tab: s.id } }"
            class="nav-item"
            :class="{ active: settingsActive === s.id }"
            :aria-current="settingsActive === s.id ? 'page' : undefined"
            :title="isCollapsed ? s.label : undefined"
            :data-testid="`settings-${s.id}`"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="s.icon" /></svg>
            <span v-if="!isCollapsed" class="nav-label">{{ s.label }}</span>
            <span v-if="!isCollapsed && s.count !== undefined" class="nav-count">{{ s.count }}</span>
          </router-link>
        </template>
      </nav>
      <nav v-else :aria-label="t('nav.main')" class="nav">
        <template v-if="navExperimentId && navCanRead">
          <template v-for="g in NAV" :key="g.id">
            <div v-if="g.heading" class="nav-heading" :class="{ collapsed: isCollapsed }" data-testid="nav-heading">
              <span v-if="!isCollapsed">{{ t(g.heading) }}</span>
            </div>
            <router-link
              :to="navTo(g.children[0]!)"
              class="nav-item"
              :class="{ active: isLeaf(g) && groupActive(g), open: !isLeaf(g) && groupActive(g) }"
              :aria-current="isLeaf(g) && groupActive(g) ? 'page' : undefined"
              :aria-expanded="isLeaf(g) ? undefined : groupActive(g)"
              :title="isCollapsed ? t(g.label) : undefined"
              :data-testid="`nav-${g.id}`"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="g.icon" /></svg>
              <span v-if="!isCollapsed" class="nav-label">{{ t(g.label) }}</span>
              <span v-if="!isCollapsed && g.id === 'review' && pendingReviews > 0" class="nav-badge" data-testid="pending-reviews">{{ pendingReviews }}</span>
              <span v-if="!isCollapsed && g.id === 'prompts' && pendingApprovals > 0" class="nav-badge" data-testid="pending-approvals" :title="t('nav.pendingApprovals', { count: pendingApprovals })">{{ pendingApprovals }}</span>
              <svg v-if="!isCollapsed && !isLeaf(g)" class="nav-chevron" :class="{ expanded: groupActive(g) }" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="CHEVRON" /></svg>
            </router-link>
            <div v-if="!isCollapsed && !isLeaf(g) && groupActive(g)" class="nav-sub" role="group" :aria-label="t(g.label)">
              <router-link
                v-for="c in g.children"
                :key="c.name"
                :to="navTo(c)"
                class="nav-subitem"
                :class="{ active: isActive(c.sections) }"
                :aria-current="isActive(c.sections) ? 'page' : undefined"
              >
                <span class="nav-label">{{ t(c.label) }}</span>
              </router-link>
            </div>
          </template>
        </template>
        <div class="nav-heading" :class="{ collapsed: isCollapsed }" data-testid="nav-heading"><span v-if="!isCollapsed">{{ t("nav.workspace") }}</span></div>
        <router-link
          v-if="canSeeAssistants"
          :to="{ name: 'assistants' }"
          class="nav-item"
          :class="{ active: route.meta.section === 'assistants' }"
          :aria-current="route.meta.section === 'assistants' ? 'page' : undefined"
          :title="isCollapsed ? t('nav.assistants') : undefined"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ASSISTANTS_ICON" /></svg>
          <span v-if="!isCollapsed" class="nav-label">{{ t("nav.assistants") }}</span>
        </router-link>
        <router-link
          :to="{ name: 'model-pricing' }"
          class="nav-item"
          :class="{ active: route.name === 'model-pricing' }"
          :aria-current="route.name === 'model-pricing' ? 'page' : undefined"
          :title="isCollapsed ? t('nav.modelPricing') : undefined"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="PRICING_ICON" /></svg>
          <span v-if="!isCollapsed" class="nav-label">{{ t("nav.modelPricing") }}</span>
        </router-link>
      </nav>
      <div class="sidebar-foot">
        <router-link
          :to="{ name: 'admin' }"
          class="nav-item"
          :class="{ active: route.meta.section === 'admin' }"
          :aria-current="route.meta.section === 'admin' ? 'page' : undefined"
          :title="isCollapsed ? t('common.settings') : undefined"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ADMIN_ICON" /></svg>
          <span v-if="!isCollapsed" class="nav-label">{{ t("common.settings") }}</span>
        </router-link>
        <UserMenu :collapsed="isCollapsed" />
      </div>
    </aside>
    <div class="main-col">
      <header class="topbar">
        <div ref="topbarLeft" class="topbar-left">
          <span v-if="leftCount === 0" class="topbar-title">{{ routeTitle(route.meta.title) }}</span>
        </div>
        <div ref="topbarRight" class="topbar-right" />
        <div v-if="currentExperimentId && navCanRead && route.meta.timeRange !== false" class="topbar-filters">
          <FilterBar :range="f.range.value" :custom="f.customRange.value" @update:range="f.setRange" @update:custom="f.setCustomRange" />
          <LiveControl :seconds="liveSeconds" :updated-at="liveUpdatedAt" @update:seconds="setRefreshSeconds" @refresh="requestRefresh" />
        </div>
        <AlertBell />
      </header>
      <main class="content" :class="{ scroll: !framed }">
        <LoadingState v-if="booting" size="lg" />
        <!-- key por experimento: al cambiar de experimento la misma ruta se remonta y recarga sus datos -->
        <router-view v-else-if="framed" :key="currentExperimentId ?? undefined" />
        <q-layout v-else view="hHh lpR fFf" container class="layout">
          <q-page-container><router-view :key="currentExperimentId ?? undefined" /></q-page-container>
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
/* título de bloque (Observe / Watch / Improve / Workspace); plegado queda solo la línea separadora */
.nav-heading {
  margin: 12px 10px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.nav-heading.collapsed {
  height: 1px;
  margin: 8px 8px;
  background: var(--mt-line);
}
.nav > .nav-heading:first-child {
  margin-top: 0;
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
.nav-back {
  margin-bottom: 4px;
}
.nav-title {
  margin: 8px 10px 0;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--mt-ink);
  overflow-wrap: anywhere;
}
.nav-group {
  margin: 14px 10px 4px;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.nav-count {
  min-width: 20px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
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
