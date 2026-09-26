<script setup lang="ts">
import { useQuasar } from "quasar";
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFilters } from "../composables/useFilters";

const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const { shared } = useFilters();

type Mode = "auto" | "light" | "dark";
const MODES: Mode[] = ["auto", "light", "dark"];
const stored = (() => {
  try {
    return localStorage.getItem("memtrace.theme");
  } catch {
    return null;
  }
})();
const mode = computed(() => ($q.dark.mode === "auto" ? "auto" : $q.dark.mode ? "dark" : "light") as Mode);
if (stored === "light" || stored === "dark") $q.dark.set(stored === "dark");

function cycleTheme() {
  const next = MODES[(MODES.indexOf(mode.value) + 1) % MODES.length]!;
  $q.dark.set(next === "auto" ? "auto" : next === "dark");
  try {
    localStorage.setItem("memtrace.theme", next);
  } catch {
    /* almacenamiento no disponible */
  }
}
const themeIcon = computed(() => ({ auto: "brightness_auto", light: "light_mode", dark: "dark_mode" })[mode.value]);
// el detalle de una traza pertenece a la sección "Trazas"
const section = computed(() => (route.name === "metrics" ? "metrics" : "traces"));
const go = (name: "traces" | "metrics") => void router.push({ name, query: shared.value });
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header bordered class="header">
      <q-toolbar>
        <router-link :to="{ name: 'traces' }" class="brand" aria-label="MemTrace">
          <span class="brand-mark">🧠</span><span class="text-weight-bold">MemTrace</span>
        </router-link>
        <q-tabs :model-value="section" no-caps align="left" class="q-ml-lg" active-color="primary" indicator-color="primary" shrink>
          <q-tab name="traces" label="Trazas" icon="timeline" @click="go('traces')" />
          <q-tab name="metrics" label="Métricas" icon="insights" @click="go('metrics')" />
        </q-tabs>
        <q-space />
        <q-btn flat round dense :icon="themeIcon" :aria-label="`Tema: ${mode}`" @click="cycleTheme">
          <q-tooltip>Tema: {{ mode === "auto" ? "según el sistema" : mode === "dark" ? "oscuro" : "claro" }}</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>
    <q-page-container><router-view /></q-page-container>
  </q-layout>
</template>

<style scoped>
.header {
  background: var(--header-bg);
  color: inherit;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  text-decoration: none;
  font-size: 18px;
}
.brand-mark {
  font-size: 22px;
}
</style>
