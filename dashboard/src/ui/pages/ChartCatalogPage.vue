<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import type { ChartCatalogEntryDto } from "@contract";
import ChartCatalogTable from "../components/ChartCatalogTable.vue";
import PageHeader from "../components/PageHeader.vue";
import { useFilters } from "../composables/useFilters";
import { useIdentityApi } from "../composables/useIdentityApi";
import { usePermissions } from "../composables/usePermissions";

/**
 * Overview › Data catalog (ADR-079): todos los pasos y atributos que ven las Custom charts, con el nombre que les pone el equipo
 * y si se muestran u ocultan en los selectores. Es la misma tabla del botón «Customize names» del builder, a página completa y
 * con buscador. Quien no tiene `catalog:manage` la ve en solo lectura.
 */
const route = useRoute();
const f = useFilters();
const identity = useIdentityApi();
const { can } = usePermissions();

const experimentId = computed(() => route.params.experimentId as string);
const range = computed(() => f.resolve());
const entries = ref<ChartCatalogEntryDto[] | null>(null);
const search = ref("");

async function load() {
  try {
    entries.value = await identity.listChartCatalog(experimentId.value);
  } catch {
    entries.value = [];
  }
}
void load();
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Overview' }, { label: 'Data catalog' }]" icon="M4 6h16M4 12h16M4 18h10" title="Data catalog" />
    <div class="mt-card body" data-testid="catalog-page">
      <p class="intro">
        Everything your agent reports that Custom charts can use. Name each step and attribute the way your team talks about it, and hide the details nobody needs to pick.
        Names apply to every chart, including saved ones.
        <template v-if="!can('catalog:manage')"> You can look but not change it: editing needs the catalog permission.</template>
      </p>
      <input v-model="search" class="search" type="search" placeholder="Search steps and attributes…" aria-label="Search the catalog" data-testid="catalog-search" />
      <p v-if="entries === null" class="muted">Loading…</p>
      <ChartCatalogTable v-else :experiment-id="experimentId" :range="range" :entries="entries" :readonly="!can('catalog:manage')" :search="search" @changed="entries = $event" />
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 24px 20px; background: var(--mt-bg); }
.body { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; }
.intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mt-muted); max-width: 80ch; }
.muted { font-size: 12px; color: var(--mt-muted); }
.search { height: 36px; max-width: 420px; padding: 0 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; }
</style>
