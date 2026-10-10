<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
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
const table = ref<InstanceType<typeof ChartCatalogTable> | null>(null);
const dirty = ref(0);
const saving = ref(false);
async function saveAll() {
  saving.value = true;
  try {
    await table.value?.saveAll();
  } finally {
    saving.value = false;
  }
}

// avisa antes de perder cambios sin guardar al cerrar o recargar la pestaña
function warnUnsaved(e: BeforeUnloadEvent) {
  if (dirty.value > 0) e.preventDefault();
}
window.addEventListener("beforeunload", warnUnsaved);
onBeforeUnmount(() => window.removeEventListener("beforeunload", warnUnsaved));

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
      <ChartCatalogTable v-else ref="table" manual :experiment-id="experimentId" :range="range" :entries="entries" :readonly="!can('catalog:manage')" :search="search" @changed="entries = $event" @dirty="dirty = $event" />
      <div v-if="dirty > 0" class="savebar" role="status" data-testid="catalog-savebar">
        <span>{{ dirty }} unsaved {{ dirty === 1 ? "change" : "changes" }}</span>
        <button type="button" class="ghost" :disabled="saving" data-testid="catalog-discard" @click="table?.discard()">Discard</button>
        <button type="button" class="primary" :disabled="saving" data-testid="catalog-save" @click="saveAll">{{ saving ? "Saving…" : "Save changes" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 24px 20px; background: var(--mt-bg); }
.body { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; }
.intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mt-muted); max-width: 80ch; }
.muted { font-size: 12px; color: var(--mt-muted); }
.savebar { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 10px 14px; margin: 0 -20px -18px; border-top: 1px solid var(--mt-line); background: var(--mt-card, var(--mt-bg)); font-size: 13px; }
.savebar span { margin-right: auto; color: var(--mt-muted); }
.savebar button { height: 32px; padding: 0 14px; border-radius: var(--mt-radius-sm); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.savebar .primary { border: none; background: var(--mt-accent); color: #fff; }
.savebar .ghost { border: 1px solid var(--mt-line); background: transparent; color: var(--mt-ink); }
.savebar button:disabled { opacity: 0.5; cursor: default; }
.search { height: 36px; max-width: 420px; padding: 0 12px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; }
</style>
