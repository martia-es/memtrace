<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../components/Select.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAsync } from "../composables/useAsync";
import { useAssistantApi } from "../composables/useAssistantApi";
import { useIdentityApi } from "../composables/useIdentityApi";
import { hasPermission } from "../composables/usePermissions";
import { HEALTH_LABEL } from "@/domain/assistants";
import AssistantCard from "../components/assistants/AssistantCard.vue";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterPill from "../components/FilterPill.vue";
import PageHeader from "../components/PageHeader.vue";
import Checkbox from "../components/Checkbox.vue";

/** Catálogo de asistentes de la organización (ADR-053): una tarjeta de presentación por experimento registrado. */
const ORG_KEY = "memtrace:assistantsOrganizationId";
const REFRESH_MS = 30_000;

const api = useAssistantApi();
const identity = useIdentityApi();

const organizations = useAsync((signal) => identity.listOrganizations(signal));
void organizations.run();

const readable = computed(() => (organizations.data.value ?? []).filter((o) => hasPermission(o, "governance:read")));
const organizationId = ref<string | null>(null);
watch(
  readable,
  (list) => {
    if (organizationId.value && list.some((o) => o.id === organizationId.value)) return;
    const saved = (() => {
      try {
        return localStorage.getItem(ORG_KEY);
      } catch {
        return null;
      }
    })();
    organizationId.value = list.find((o) => o.id === saved)?.id ?? list[0]?.id ?? null;
  },
  { immediate: true },
);
const organization = computed(() => readable.value.find((o) => o.id === organizationId.value) ?? null);

const catalog = useAsync((signal) => (organizationId.value ? api.listCatalog(organizationId.value, signal) : Promise.resolve([])));
watch(organizationId, (id) => {
  if (!id) return;
  try {
    localStorage.setItem(ORG_KEY, id);
  } catch {
    /* sin almacenamiento: se pierde solo la preferencia */
  }
  void catalog.run();
});

// la salud cambia sola: se relee el catálogo mientras la página está abierta
const nowMs = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now();
    if (organizationId.value) void catalog.run();
  }, REFRESH_MS);
});
onBeforeUnmount(() => clearInterval(timer));

const cards = computed(() => catalog.data.value ?? []);

// ── filtros ────────────────────────────────────────────────────────────────────────────────────────────────
const search = ref("");
const environment = ref<string | undefined>(undefined);
const status = ref<string | undefined>(undefined);
const onlyIssues = ref(false);

const slots = computed(() => {
  const byKey = new Map<string, { id: string; key: string; label: string; position: number }>();
  for (const c of cards.value) for (const d of c.deployments) byKey.set(d.environment.key, d.environment);
  return [...byKey.values()].sort((a, b) => a.position - b.position);
});
const environmentOptions = computed(() => slots.value.map((s) => ({ label: s.label, value: s.key })));
const statusOptions = (["up", "degraded", "down", "unknown"] as const).map((s) => ({ label: HEALTH_LABEL[s], value: s }));

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return cards.value.filter((c) => {
    if (q && ![c.name, c.description, c.owner?.name ?? "", c.owner?.email ?? ""].some((t) => t.toLowerCase().includes(q))) return false;
    if (environment.value && !c.deployments.some((d) => d.environment.key === environment.value)) return false;
    if (status.value && !c.deployments.some((d) => d.healthStatus === status.value && (!environment.value || d.environment.key === environment.value))) return false;
    if (onlyIssues.value && !(c.status === "down" || c.status === "degraded" || c.connectionCounts.toReview > 0)) return false;
    return true;
  });
});

// ── resumen ────────────────────────────────────────────────────────────────────────────────────────────────
const summary = computed(() => {
  const deployments = cards.value.flatMap((c) => c.deployments);
  return {
    assistants: cards.value.length,
    up: deployments.filter((d) => d.healthStatus === "up").length,
    deployed: deployments.length,
    attention: deployments.filter((d) => d.healthStatus === "down" || d.healthStatus === "degraded").length,
    toReview: cards.value.reduce((n, c) => n + c.connectionCounts.toReview, 0),
  };
});

// los permisos de la organización decidirán si se ofrece crear agentes (experimentos) en Settings
const canCreateAgents = computed(() => hasPermission(organization.value, "experiment:create"));
const organizationOptions = computed(() => readable.value.map((o) => ({ label: o.name, value: o.id })));
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Assistants' }]" icon="M12 8V4M8 4h8M5 8h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM9 14h.01M15 14h.01" title="Assistants">
      <div class="actions">
        <div v-if="readable.length > 1" class="org-select"><Select v-model="organizationId" :options="organizationOptions" aria-label="Organization" /></div>
        <router-link v-if="canCreateAgents && organizationId" :to="{ name: 'admin-organization', params: { organizationId } }" class="primary mt-new" data-testid="create-agent">+ New agent</router-link>
      </div>
    </PageHeader>

    <ErrorBanner v-if="catalog.error.value" :error="catalog.error.value" @retry="catalog.run()" />
    <div v-else-if="(organizations.loading.value || catalog.loading.value) && !catalog.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="!organization" icon="lock" title="No access to the catalog">
      You need the governance permission in an organization to see its assistants. Ask an organization admin.
    </EmptyState>

    <template v-else>
      <section class="summary mt-card" aria-label="Summary">
        <div class="stat"><b>{{ summary.assistants }}</b><span>assistants</span></div>
        <div class="stat ok"><b>{{ summary.up }} / {{ summary.deployed }}</b><span>environments up</span></div>
        <div class="stat" :class="{ err: summary.attention > 0 }"><b>{{ summary.attention }}</b><span>degraded or down</span></div>
        <div class="stat" :class="{ warn: summary.toReview > 0 }"><b>{{ summary.toReview }}</b><span>connections to review</span></div>
        <div class="grow" />
        <span class="hint">Health is checked automatically; this page refreshes every 30 s</span>
      </section>

      <div class="filters">
        <TextInput type="search" v-model="search" placeholder="Search by name, description or owner…" class="search" />
        <FilterPill label="Environment" :model-value="environment" :options="environmentOptions" all-label="All" @update:model-value="environment = $event" />
        <FilterPill label="Status" :model-value="status" :options="statusOptions" all-label="All" @update:model-value="status = $event" />
        <Checkbox class="toggle" v-model="onlyIssues">Only with issues</Checkbox>
      </div>

      <EmptyState v-if="cards.length === 0" icon="smart_toy" title="No agents yet">
        Every experiment is an agent and appears here as soon as it is created. Create one in Settings.
      </EmptyState>
      <EmptyState v-else-if="visible.length === 0" icon="search_off" title="No assistants match">Try a different search or clear the filters.</EmptyState>
      <section v-else class="cards" data-testid="assistant-cards">
        <AssistantCard v-for="c in visible" :key="c.experimentId" :card="c" :slots="slots" />
      </section>
    </template>

  </div>
</template>

<style scoped>
.page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 14px; padding: 16px 24px 24px; background: var(--mt-bg); }
.actions { display: flex; align-items: center; gap: 10px; }
.org-select { min-width: 180px; }
.primary { display: inline-flex; align-items: center; height: 32px; padding: 0 14px; text-decoration: none; font: inherit; font-size: 13px; font-weight: 700; color: var(--mt-accent-ink); background: var(--mt-accent); border: none; border-radius: var(--mt-radius-sm); cursor: pointer; }
.primary:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
.loading { display: flex; justify-content: center; padding: 60px; }
.summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 28px; padding: 10px 18px; }
.stat { display: flex; align-items: baseline; gap: 8px; }
.stat b { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; }
.stat span { font-size: 12px; font-weight: 600; color: var(--mt-muted); }
.stat.ok b { color: var(--mt-ok-ink); }
.stat.err b { color: var(--mt-err-ink); }
.stat.warn b { color: var(--mt-warn-ink); }
.grow { flex: 1; }
.hint { font-size: 12px; color: var(--mt-faint); }
.filters { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.search { width: 280px; }
.toggle { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; font-size: 13px; font-weight: 600; color: var(--mt-muted); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; align-items: stretch; }
</style>
