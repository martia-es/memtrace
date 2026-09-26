<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { useFilters } from "../composables/useFilters";

const route = useRoute();
const { shared } = useFilters();
const isCollapsed = ref(false);

const OTLP_ENDPOINT = import.meta.env.VITE_OTLP_ENDPOINT ?? "http://localhost:4318";

const NAV = [
  { name: "spans", label: "Conversaciones", icon: "M4 5h16v11H9l-5 4z" },
  { name: "metrics", label: "Métricas", icon: "M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" },
] as const;

// el detalle de una traza o de una conversación pertenece a su sección
const section = computed(() => (route.meta.section as string | undefined) ?? "spans");
// las pantallas del diseño (spans, conversación) gestionan su propio scroll; el resto van en una tarjeta que se desplaza
const framed = computed(() => route.meta.framed === true);
</script>

<template>
  <div class="shell">
    <aside class="sidebar mt-card" :class="{ collapsed: isCollapsed }">
      <div class="sidebar-header">
        <router-link :to="{ name: 'spans' }" class="brand" aria-label="MemTrace">
          <svg width="26" height="26" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="12" height="4" rx="2" fill="#6FCF4A" /><rect x="6" y="9" width="15" height="4" rx="2" fill="#7A5AF8" /><rect x="3" y="15" width="9" height="4" rx="2" fill="#FF8A3D" />
          </svg>
          <span v-if="!isCollapsed">memtrace</span>
        </router-link>
        <button
          class="collapse-btn"
          :aria-label="isCollapsed ? 'Expandir menú' : 'Contraer menú'"
          @click="isCollapsed = !isCollapsed"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="isCollapsed ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'" />
          </svg>
        </button>
      </div>
      <nav aria-label="Principal" class="nav">
        <router-link
          v-for="item in NAV"
          :key="item.name"
          :to="{ name: item.name, query: shared }"
          class="nav-item"
          :class="{ active: section === item.name }"
          :aria-current="section === item.name ? 'page' : undefined"
          :title="isCollapsed ? item.label : undefined"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.icon" /></svg>
          <span v-if="!isCollapsed">{{ item.label }}</span>
        </router-link>
      </nav>
      <div v-if="!isCollapsed" class="otlp">
        <span class="otlp-title">Endpoint OTLP</span>
        <span class="mono otlp-url">{{ OTLP_ENDPOINT }}</span>
      </div>
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
  gap: 16px;
  height: 100vh;
  min-height: 640px;
  padding: 28px;
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
