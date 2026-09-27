<script setup lang="ts">
import { computed, provide, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFilters } from "../composables/useFilters";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import ExperimentSelect from "../components/ExperimentSelect.vue";
import UserMenu from "../components/UserMenu.vue";

const route = useRoute();
const router = useRouter();
const f = useFilters();
const { shared } = f;
const identityApi = useIdentityApi();
const isCollapsed = ref(false);
const experiments = useAsync((signal) => identityApi.listExperiments(signal));
void experiments.run();

const OTLP_ENDPOINT = import.meta.env.VITE_OTLP_ENDPOINT ?? "http://localhost:4318";

const NAV = [
  { name: "conversations", label: "Conversations", icon: "M4 5h16v11H9l-5 4z" },
  { name: "metrics", label: "Metrics", icon: "M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" },
] as const;
// gestión de organizaciones/experimentos/API keys (ADR-013): no cuelga de :experimentId
const ADMIN_ICON = "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.4 7.4 0 0 0 .1-1 7.4 7.4 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.6a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.6a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6z";

// every route rendered inside MainLayout declares its own meta.section explicitly
const section = computed(() => route.meta.section as string | undefined);
// design screens (conversations, trace) manage their own scroll; the rest go in a card that scrolls
const framed = computed(() => route.meta.framed === true);
const experimentOptions = computed(() => experiments.data.value ?? []);
const currentExperimentId = computed(() => (route.params.experimentId as string | undefined) ?? null);
const currentExperiment = computed(() => experimentOptions.value.find((e) => e.id === currentExperimentId.value) ?? null);
provide(CURRENT_EXPERIMENT, currentExperiment);

// en /admin no hay :experimentId en la ruta, pero Conversations/Metrics necesitan uno para su link:
// se cae al último usado (o al primero disponible) para no perder el contexto al volver.
const navExperimentId = computed(
  () => currentExperimentId.value ?? localStorage.getItem("memtrace:lastExperimentId") ?? experimentOptions.value[0]?.id ?? null,
);

function switchExperiment(experimentId: string | null) {
  if (!experimentId) return;
  void router.push({ name: "conversations", params: { experimentId } });
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar mt-card" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-header">
        <router-link :to="{ name: 'conversations', params: { experimentId: currentExperimentId } }" class="brand" aria-label="MemTrace">
          <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4" rx="2" fill="#6FCF4A" /><rect x="6" y="9" width="15" height="4" rx="2" fill="#7A5AF8" /><rect x="3" y="15" width="9" height="4" rx="2" fill="#FF8A3D" />
          </svg>
          <span v-if="!isCollapsed">memtrace</span>
        </router-link>
        <button
          class="collapse-btn"
          :aria-label="isCollapsed ? 'Expand menu' : 'Collapse menu'"
          @click="isCollapsed = !isCollapsed"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="isCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
          </svg>
        </button>
      </div>
      <section v-if="!isCollapsed" class="sidebar-filters">
        <div class="sidebar-filter-label">Experiment</div>
        <ExperimentSelect
          :model-value="currentExperimentId"
          :options="experimentOptions"
          :loading="experiments.loading.value"
          @update:model-value="switchExperiment"
        />
      </section>
      <nav aria-label="Main" class="nav">
        <router-link
          v-for="item in NAV"
          v-show="navExperimentId"
          :key="item.name"
          :to="{ name: item.name, params: { experimentId: navExperimentId }, query: shared }"
          class="nav-item"
          :class="{ active: section === item.name }"
          :aria-current="section === item.name ? 'page' : undefined"
          :title="isCollapsed ? item.label : undefined"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.icon" /></svg>
          <span v-if="!isCollapsed">{{ item.label }}</span>
        </router-link>
        <router-link
          :to="{ name: 'admin' }"
          class="nav-item"
          :class="{ active: route.name === 'admin' }"
          :aria-current="route.name === 'admin' ? 'page' : undefined"
          :title="isCollapsed ? 'Admin' : undefined"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="ADMIN_ICON" /></svg>
          <span v-if="!isCollapsed">Admin</span>
        </router-link>
      </nav>
      <UserMenu :collapsed="isCollapsed" />
    </aside>
    <main class="content" :class="{ scroll: !framed }">
      <router-view v-if="framed" />
      <q-layout v-else view="hHh lpR fFf" container class="layout">
        <q-page-container><router-view /></q-page-container>
      </q-layout>
    </main>
  </div>
</template>

<style scoped>
.shell {
  box-sizing: border-box;
  display: flex;
  gap: 12px;
  height: 100vh;
  min-height: 640px;
  padding: 14px;
  font-size: 13px;
}
.sidebar {
  width: 232px;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 20px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  transition: width 0.3s ease-out;
}
.sidebar.collapsed {
  width: 80px;
  padding: 20px 8px 16px;
}
.sidebar.collapsed .sidebar-header {
  flex-direction: column;
  justify-content: flex-start;
  gap: 10px;
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  color: inherit;
  text-decoration: none;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.03em;
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
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.2s ease;
}
.collapse-btn:hover {
  background: var(--mt-soft);
  color: var(--mt-text);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 14px;
  border-radius: 22px;
  color: var(--mt-muted);
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s ease, color 0.2s ease;
}
.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 0 8px;
  border-radius: 12px;
  gap: 0;
}
.nav-item:hover {
  background: var(--mt-soft);
}
.nav-item.active {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.sidebar-filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px;
}
.sidebar-filter-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.otlp {
  margin-top: auto;
  padding: 14px;
  border-radius: 20px;
  background: #eaf8d6;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.otlp-title {
  font-size: 12px;
  font-weight: 600;
  color: #2a5a0d;
}
.otlp-url {
  font-size: 11px;
  word-break: break-all;
  color: #1e3a0b;
}
.content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* páginas "clásicas" (trazas, métricas): una tarjeta blanca que se desplaza */
.content.scroll {
  overflow: auto;
  background: var(--mt-card);
  border-radius: 28px;
  box-shadow: var(--mt-shadow);
}
.layout {
  flex: 1;
  min-height: 0;
  background: transparent;
}
</style>
