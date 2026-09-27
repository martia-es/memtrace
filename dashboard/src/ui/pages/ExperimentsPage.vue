<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import type { ApiKeyDto, ExperimentDto, MembersResponseDto, OrganizationDto } from "@/application/identity-api";
import PageHeader from "../components/PageHeader.vue";
import EmptyState from "../components/EmptyState.vue";
import Select from "../components/Select.vue";
import Modal from "../components/Modal.vue";

const api = useIdentityApi();
const $q = useQuasar();

const organizations = useAsync((signal) => api.listOrganizations(signal));
const experiments = useAsync((signal) => api.listExperiments(signal));

// Los contadores de miembros/invitaciones deben verse sin necesidad de desplegar cada fila:
// se cargan todos en cuanto tenemos organizaciones y experimentos, no al hacer clic.
const membersLoaded = ref(false);
async function bootstrap() {
  await Promise.all([organizations.run(), experiments.run()]);
  await refreshAllMembers();
  membersLoaded.value = true;
}
void bootstrap();

async function refreshAllMembers() {
  // Ver el listado de miembros requiere poder gestionarlos (ADR-016): un member solo ve lo suyo,
  // así que ni lo intentamos para las orgs/experimentos donde no es org_admin/admin (evita 403 en cascada).
  await Promise.all([
    ...(organizations.data.value ?? []).filter(canManageOrg).map(async (o) => {
      membersByOrg[o.id] = await api.listOrgMembers(o.id);
    }),
    ...(experiments.data.value ?? []).filter(canManageExperiment).map(async (e) => {
      membersByExperiment[e.id] = await api.listExperimentMembers(e.id);
    }),
  ]);
}

// ---- permisos por fila (ADR-016): admin siempre ve todo, member solo lee y se genera su API key ----
function canManageOrg(o: OrganizationDto): boolean {
  return o.myRole === "org_admin";
}
function canManageExperiment(e: ExperimentDto): boolean {
  return e.myRole === "org_admin" || e.myRole === "admin";
}

function notifyError(action: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  $q.notify({ message: `${action}: ${detail}`, color: "negative", timeout: 4000 });
}

// ---- organizaciones ----
const showOrgModal = ref(false);
const newOrgName = ref("");
const creatingOrg = ref(false);
async function createOrganization() {
  if (!newOrgName.value.trim()) return;
  creatingOrg.value = true;
  try {
    await api.createOrganization(newOrgName.value.trim());
    newOrgName.value = "";
    showOrgModal.value = false;
    await organizations.run();
    await refreshAllMembers();
  } catch (error) {
    notifyError("No se pudo crear la organización", error);
  } finally {
    creatingOrg.value = false;
  }
}

// ---- invitar org_admin ----
const showOrgInviteModal = ref(false);
const inviteOrgId = ref<string | null>(null);
const orgInviteEmail = ref("");
const invitingOrgAdmin = ref(false);
function openOrgInviteModal(organizationId: string) {
  inviteOrgId.value = organizationId;
  orgInviteEmail.value = "";
  showOrgInviteModal.value = true;
}
async function inviteOrgAdmin() {
  if (!inviteOrgId.value || !orgInviteEmail.value.trim()) return;
  invitingOrgAdmin.value = true;
  try {
    const organizationId = inviteOrgId.value;
    await api.addOrgAdmin(organizationId, orgInviteEmail.value.trim());
    showOrgInviteModal.value = false;
    $q.notify({ message: "Invitación enviada", color: "positive", timeout: 2500 });
    membersByOrg[organizationId] = await api.listOrgMembers(organizationId);
    expandedOrgMembersId.value = organizationId;
  } catch (error) {
    notifyError("No se pudo invitar", error);
  } finally {
    invitingOrgAdmin.value = false;
  }
}

// ---- miembros e invitaciones pendientes de organización (precargados, ver bootstrap) ----
const expandedOrgMembersId = ref<string | null>(null);
const membersByOrg = reactive<Record<string, MembersResponseDto>>({});
function toggleOrgMembers(organizationId: string) {
  expandedOrgMembersId.value = expandedOrgMembersId.value === organizationId ? null : organizationId;
}
function orgMemberCount(organizationId: string): number {
  return membersByOrg[organizationId]?.members.length ?? 0;
}
function orgPendingCount(organizationId: string): number {
  return membersByOrg[organizationId]?.pendingInvitations.length ?? 0;
}

const organizationOptions = computed(() => (organizations.data.value ?? []).filter(canManageOrg).map((o) => ({ label: o.name, value: o.id })));
const experimentCountByOrgId = computed(() => {
  const counts = new Map<string, number>();
  for (const e of experiments.data.value ?? []) counts.set(e.organizationId, (counts.get(e.organizationId) ?? 0) + 1);
  return counts;
});
const experimentsByOrgId = computed(() => {
  const groups = new Map<string, ExperimentDto[]>();
  for (const e of experiments.data.value ?? []) {
    const list = groups.get(e.organizationId) ?? [];
    list.push(e);
    groups.set(e.organizationId, list);
  }
  return groups;
});

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = { org_admin: "org_admin", admin: "admin", member: "member" };

// ---- directorio: todos los miembros e invitaciones, de un vistazo, con a qué pertenecen ----
interface DirectoryRow {
  id: string;
  name: string;
  email: string;
  scopeLabel: string;
  scopeType: "org" | "experiment";
  role: string;
  status: "active" | "pending";
  date: string | null;
}
const directoryRows = computed<DirectoryRow[]>(() => {
  const rows: DirectoryRow[] = [];
  for (const o of organizations.data.value ?? []) {
    const data = membersByOrg[o.id];
    if (!data) continue;
    for (const m of data.members) {
      rows.push({ id: `org-m-${o.id}-${m.userId}`, name: m.name ?? m.email, email: m.email, scopeLabel: o.name, scopeType: "org", role: m.role, status: "active", date: null });
    }
    for (const inv of data.pendingInvitations) {
      rows.push({ id: `org-p-${inv.id}`, name: inv.email, email: inv.email, scopeLabel: o.name, scopeType: "org", role: inv.role, status: "pending", date: inv.createdAt });
    }
  }
  for (const e of experiments.data.value ?? []) {
    const data = membersByExperiment[e.id];
    if (!data) continue;
    for (const m of data.members) {
      rows.push({ id: `exp-m-${e.id}-${m.userId}`, name: m.name ?? m.email, email: m.email, scopeLabel: e.name, scopeType: "experiment", role: m.role, status: "active", date: null });
    }
    for (const inv of data.pendingInvitations) {
      rows.push({ id: `exp-p-${inv.id}`, name: inv.email, email: inv.email, scopeLabel: e.name, scopeType: "experiment", role: inv.role, status: "pending", date: inv.createdAt });
    }
  }
  return rows.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "pending" ? 1 : -1));
});
const directoryFilter = ref("");
const filteredDirectoryRows = computed(() => {
  const q = directoryFilter.value.trim().toLowerCase();
  if (!q) return directoryRows.value;
  return directoryRows.value.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.scopeLabel.toLowerCase().includes(q));
});

// ---- experimentos ----
const showExperimentModal = ref(false);
const selectedOrgId = ref<string | null>(null);
const newServiceName = ref("");
const newExperimentName = ref("");
const experimentNameTouched = ref(false);
// por defecto el nombre visible es el mismo service.name: son la misma cosa hasta que el usuario lo cambie a mano
function onServiceNameInput() {
  if (!experimentNameTouched.value) newExperimentName.value = newServiceName.value;
}
function openExperimentModal(organizationId?: string) {
  selectedOrgId.value = organizationId ?? organizationOptions.value[0]?.value ?? null;
  showExperimentModal.value = true;
}
const creatingExperiment = ref(false);
async function createExperiment() {
  if (!selectedOrgId.value || !newExperimentName.value.trim() || !newServiceName.value.trim()) return;
  creatingExperiment.value = true;
  try {
    await api.createExperiment(selectedOrgId.value, newExperimentName.value.trim(), newServiceName.value.trim());
    newExperimentName.value = "";
    newServiceName.value = "";
    experimentNameTouched.value = false;
    showExperimentModal.value = false;
    await experiments.run();
    await refreshAllMembers();
  } catch (error) {
    notifyError("No se pudo crear el experimento", error);
  } finally {
    creatingExperiment.value = false;
  }
}

// ---- invitar a experimento ----
const showExperimentInviteModal = ref(false);
const inviteExperimentId = ref<string | null>(null);
const experimentInviteEmail = ref("");
const experimentInviteRole = ref<"admin" | "member">("member");
const invitingExperimentMember = ref(false);
const experimentRoleOptions = [
  { label: "member (solo lectura)", value: "member" as const },
  { label: "admin (puede invitar)", value: "admin" as const },
];
function openExperimentInviteModal(experimentId: string) {
  inviteExperimentId.value = experimentId;
  experimentInviteEmail.value = "";
  experimentInviteRole.value = "member";
  showExperimentInviteModal.value = true;
}
async function inviteExperimentMember() {
  if (!inviteExperimentId.value || !experimentInviteEmail.value.trim()) return;
  invitingExperimentMember.value = true;
  try {
    const experimentId = inviteExperimentId.value;
    await api.addExperimentMember(experimentId, experimentInviteEmail.value.trim(), experimentInviteRole.value);
    showExperimentInviteModal.value = false;
    $q.notify({ message: "Invitación enviada", color: "positive", timeout: 2500 });
    membersByExperiment[experimentId] = await api.listExperimentMembers(experimentId);
    expandedMembersId.value = experimentId;
  } catch (error) {
    notifyError("No se pudo invitar", error);
  } finally {
    invitingExperimentMember.value = false;
  }
}

// ---- miembros e invitaciones pendientes de experimento (precargados, ver bootstrap) ----
const expandedMembersId = ref<string | null>(null);
const membersByExperiment = reactive<Record<string, MembersResponseDto>>({});
function toggleExperimentMembers(experimentId: string) {
  expandedMembersId.value = expandedMembersId.value === experimentId ? null : experimentId;
}
function expMemberCount(experimentId: string): number {
  return membersByExperiment[experimentId]?.members.length ?? 0;
}
function expPendingCount(experimentId: string): number {
  return membersByExperiment[experimentId]?.pendingInvitations.length ?? 0;
}

// ---- API keys (ADR-013, pieza 9) ----
const expandedId = ref<string | null>(null);
const apiKeysByExperiment = reactive<Record<string, ApiKeyDto[]>>({});
const loadingKeys = ref(false);
const generatingKey = ref(false);
const revealedKey = ref<{ experimentId: string; plaintext: string } | null>(null);

async function toggleApiKeys(experimentId: string) {
  revealedKey.value = null;
  if (expandedId.value === experimentId) {
    expandedId.value = null;
    return;
  }
  expandedId.value = experimentId;
  loadingKeys.value = true;
  try {
    apiKeysByExperiment[experimentId] = await api.listApiKeys(experimentId);
  } catch (error) {
    notifyError("No se pudieron cargar las API keys", error);
  } finally {
    loadingKeys.value = false;
  }
}

async function generateApiKey(experimentId: string) {
  generatingKey.value = true;
  try {
    const created = await api.createApiKey(experimentId);
    revealedKey.value = { experimentId, plaintext: created.plaintext };
    apiKeysByExperiment[experimentId] = await api.listApiKeys(experimentId);
  } catch (error) {
    notifyError("No se pudo generar la API key", error);
  } finally {
    generatingKey.value = false;
  }
}

async function revokeApiKey(experimentId: string, keyId: string) {
  try {
    await api.revokeApiKey(experimentId, keyId);
    apiKeysByExperiment[experimentId] = await api.listApiKeys(experimentId);
  } catch (error) {
    notifyError("No se pudo revocar la API key", error);
  }
}

function envSnippet(experiment: ExperimentDto, plaintext: string): string {
  const ingestUrl = `${window.location.origin}/api/v1/ingest`;
  return `MEMTRACE_SERVICE_NAME="${experiment.serviceName}"
MEMTRACE_OTLP_PROTOCOL="http"
MEMTRACE_OTLP_ENDPOINT="${ingestUrl}"
MEMTRACE_OTLP_HEADERS="Authorization=Bearer ${plaintext}"
MEMTRACE_CAPTURE_CONTENT="true"`;
}

function copyEnvSnippet(experiment: ExperimentDto, plaintext: string) {
  void navigator.clipboard.writeText(envSnippet(experiment, plaintext));
  $q.notify({ message: "Copiado", timeout: 1200, position: "bottom" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Admin' }]" icon="M4 5h16v11H9l-5 4z" title="Admin" />

    <section class="section-head">
      <div>
        <h2>Organizaciones</h2>
        <p class="section-sub">Cada organización agrupa sus experimentos y sus miembros con acceso.</p>
      </div>
      <button class="primary-btn" type="button" @click="showOrgModal = true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Nueva organización
      </button>
    </section>

    <EmptyState v-if="!organizations.loading.value && !organizations.data.value?.length" icon="apartment" title="Todavía no tienes acceso a ninguna organización ni experimento">
      Crea una organización para empezar — te conviertes en su primer org_admin.
    </EmptyState>

    <div v-else class="org-grid">
      <article v-for="o in organizations.data.value" :key="o.id" class="org-card mt-card">
        <header class="org-card-head">
          <div class="avatar">{{ initials(o.name) }}</div>
          <div class="org-info">
            <h3>{{ o.name }}</h3>
            <span class="org-meta">{{ experimentCountByOrgId.get(o.id) ?? 0 }} experimento(s)</span>
          </div>
          <span v-if="!canManageOrg(o)" class="role-pill member">acceso vía experimento</span>
          <template v-if="canManageOrg(o)">
            <button
              class="chevron-btn"
              type="button"
              :class="{ open: expandedOrgMembersId === o.id }"
              :aria-expanded="expandedOrgMembersId === o.id"
              @click="toggleOrgMembers(o.id)"
            >
              <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              <span v-if="membersLoaded">{{ orgMemberCount(o.id) }} miembro(s)</span>
              <span v-else>Miembros</span>
              <span v-if="orgPendingCount(o.id)" class="count-badge pending">{{ orgPendingCount(o.id) }} pendiente(s)</span>
            </button>
            <button class="ghost-btn" type="button" @click="openOrgInviteModal(o.id)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" /></svg>
              Invitar org_admin
            </button>
          </template>
        </header>

        <div v-if="expandedOrgMembersId === o.id" class="members-panel">
          <ul v-if="membersByOrg[o.id]?.members.length" class="member-list">
            <li v-for="m in membersByOrg[o.id]?.members" :key="m.userId" class="member-row">
              <div class="avatar small">{{ initials(m.name ?? m.email) }}</div>
              <div class="member-info">
                <span class="member-name">{{ m.name ?? m.email }}</span>
                <span class="member-email">{{ m.email }}</span>
              </div>
              <span class="role-pill" :class="m.role">{{ ROLE_LABEL[m.role] }}</span>
            </li>
          </ul>
          <p v-else class="hint">Sin miembros todavía.</p>

          <template v-if="membersByOrg[o.id]?.pendingInvitations.length">
            <p class="panel-subtitle">Invitaciones pendientes</p>
            <ul class="member-list">
              <li v-for="inv in membersByOrg[o.id]?.pendingInvitations" :key="inv.id" class="member-row pending">
                <div class="avatar small pending">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                </div>
                <div class="member-info">
                  <span class="member-name">{{ inv.email }}</span>
                  <span class="member-email">enviada {{ formatDate(inv.createdAt) }}</span>
                </div>
                <span class="role-pill outline" :class="inv.role">{{ ROLE_LABEL[inv.role] }}</span>
              </li>
            </ul>
          </template>
        </div>

        <div class="org-experiments">
          <div v-for="e in experimentsByOrgId.get(o.id) ?? []" :key="e.id" class="exp-row">
            <div class="exp-head">
              <div class="exp-main">
                <span class="name">{{ e.name }}</span>
                <span class="service mono">{{ e.serviceName }}</span>
              </div>
            </div>
            <div class="exp-actions">
              <span v-if="!canManageExperiment(e)" class="role-pill member">{{ ROLE_LABEL[e.myRole] }}</span>
              <template v-if="canManageExperiment(e)">
                <button
                  class="chevron-btn"
                  type="button"
                  :class="{ open: expandedMembersId === e.id }"
                  :aria-expanded="expandedMembersId === e.id"
                  @click="toggleExperimentMembers(e.id)"
                >
                  <svg class="chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  <span v-if="membersLoaded">{{ expMemberCount(e.id) }} miembro(s)</span>
                  <span v-else>Miembros</span>
                  <span v-if="expPendingCount(e.id)" class="count-badge pending">{{ expPendingCount(e.id) }} pendiente(s)</span>
                </button>
                <button class="ghost-btn" type="button" @click="openExperimentInviteModal(e.id)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" /></svg>
                  Invitar
                </button>
              </template>
              <button class="chevron-btn" type="button" :class="{ open: expandedId === e.id }" :aria-expanded="expandedId === e.id" @click="toggleApiKeys(e.id)">
                <svg class="chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                API key
              </button>
            </div>

            <div v-if="expandedMembersId === e.id" class="members-panel nested">
              <ul v-if="membersByExperiment[e.id]?.members.length" class="member-list">
                <li v-for="m in membersByExperiment[e.id]?.members" :key="m.userId" class="member-row">
                  <div class="avatar small">{{ initials(m.name ?? m.email) }}</div>
                  <div class="member-info">
                    <span class="member-name">{{ m.name ?? m.email }}</span>
                    <span class="member-email">{{ m.email }}</span>
                  </div>
                  <span class="role-pill" :class="m.role">{{ ROLE_LABEL[m.role] }}</span>
                </li>
              </ul>
              <p v-else class="hint">Sin miembros todavía.</p>

              <template v-if="membersByExperiment[e.id]?.pendingInvitations.length">
                <p class="panel-subtitle">Invitaciones pendientes</p>
                <ul class="member-list">
                  <li v-for="inv in membersByExperiment[e.id]?.pendingInvitations" :key="inv.id" class="member-row pending">
                    <div class="avatar small pending">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                    </div>
                    <div class="member-info">
                      <span class="member-name">{{ inv.email }}</span>
                      <span class="member-email">enviada {{ formatDate(inv.createdAt) }}</span>
                    </div>
                    <span class="role-pill outline" :class="inv.role">{{ ROLE_LABEL[inv.role] }}</span>
                  </li>
                </ul>
              </template>
            </div>

            <div v-if="expandedId === e.id" class="members-panel nested">
              <div v-if="revealedKey?.experimentId === e.id" class="revealed-key">
                <p class="hint">Copia esto ahora — no se volverá a mostrar la key completa.</p>
                <div class="snippet-box">
                  <pre>{{ envSnippet(e, revealedKey.plaintext) }}</pre>
                  <button class="copy-btn" type="button" @click="copyEnvSnippet(e, revealedKey.plaintext)">Copiar</button>
                </div>
              </div>

              <ul v-if="apiKeysByExperiment[e.id]?.length" class="member-list">
                <li v-for="k in apiKeysByExperiment[e.id]" :key="k.id" class="member-row">
                  <span class="mono key-prefix">{{ k.keyPrefix }}…</span>
                  <span class="member-email">creada {{ formatDate(k.createdAt) }} · último uso: {{ formatDate(k.lastUsedAt) }}</span>
                  <button v-if="canManageExperiment(e)" class="revoke-btn" type="button" @click="revokeApiKey(e.id, k.id)">Revocar</button>
                </li>
              </ul>
              <p v-else-if="!loadingKeys" class="hint">Sin API keys todavía.</p>

              <button class="primary-btn generate-btn" type="button" :disabled="generatingKey" @click="generateApiKey(e.id)">
                Generar API key
              </button>
            </div>
          </div>

          <button v-if="canManageOrg(o)" class="add-experiment-btn" type="button" @click="openExperimentModal(o.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Nuevo experimento en {{ o.name }}
          </button>
        </div>
      </article>
    </div>

    <section class="section-head directory-head">
      <div>
        <h2>Todos los miembros</h2>
        <p class="section-sub">Un único listado con quién tiene acceso a qué, y qué invitaciones siguen sin aceptar.</p>
      </div>
      <input v-model="directoryFilter" class="text-input search-input" type="search" placeholder="Buscar por nombre, email u organización/experimento…" />
    </section>

    <div class="mt-card directory-card">
      <p v-if="!membersLoaded" class="hint directory-empty">Cargando…</p>
      <p v-else-if="!filteredDirectoryRows.length" class="hint directory-empty">Sin resultados.</p>
      <ul v-else class="directory-list">
        <li v-for="row in filteredDirectoryRows" :key="row.id" class="directory-row" :class="{ pending: row.status === 'pending' }">
          <div class="avatar small" :class="{ pending: row.status === 'pending' }">
            <template v-if="row.status === 'pending'">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
            </template>
            <template v-else>{{ initials(row.name) }}</template>
          </div>
          <div class="member-info">
            <span class="member-name">{{ row.name }}</span>
            <span class="member-email">{{ row.email }}</span>
          </div>
          <span class="scope-pill" :class="row.scopeType">
            <svg v-if="row.scopeType === 'org'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1" /></svg>
            <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6M10 3v5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V3" /></svg>
            {{ row.scopeLabel }}
          </span>
          <span class="role-pill" :class="[row.role, { outline: row.status === 'pending' }]">{{ ROLE_LABEL[row.role] }}</span>
          <span v-if="row.status === 'pending'" class="status-pill pending">pendiente · {{ formatDate(row.date) }}</span>
          <span v-else class="status-pill active">activo</span>
        </li>
      </ul>
    </div>

    <Modal v-if="showOrgModal" title="Nueva organización" @close="showOrgModal = false">
      <form class="modal-form" @submit.prevent="createOrganization">
        <p class="hint">Al crearla te conviertes en su primer org_admin.</p>
        <input v-model="newOrgName" class="text-input" placeholder="Nombre de la organización" autofocus />
        <button type="submit" class="primary-btn" :disabled="creatingOrg || !newOrgName.trim()">Crear</button>
      </form>
    </Modal>

    <Modal v-if="showExperimentModal" title="Nuevo experimento" @close="showExperimentModal = false">
      <form class="modal-form" @submit.prevent="createExperiment">
        <p class="hint">
          Requiere ser org_admin de la organización elegida. Un experimento son las trazas + dashboard de un agente: el
          <code>service.name</code> es el mismo valor que configuras como <code>MEMTRACE_SERVICE_NAME</code> al instrumentarlo.
        </p>
        <Select v-model="selectedOrgId" :options="organizationOptions" placeholder="Organización…" />
        <input v-model="newServiceName" class="text-input mono" placeholder="service.name (p. ej. mi-agente)" @input="onServiceNameInput" />
        <input v-model="newExperimentName" class="text-input" placeholder="Nombre a mostrar" @input="experimentNameTouched = true" />
        <button type="submit" class="primary-btn" :disabled="creatingExperiment || !selectedOrgId || !newExperimentName.trim() || !newServiceName.trim()">
          Crear
        </button>
      </form>
    </Modal>

    <Modal v-if="showOrgInviteModal" title="Invitar org_admin" @close="showOrgInviteModal = false">
      <form class="modal-form" @submit.prevent="inviteOrgAdmin">
        <p class="hint">
          La persona invitada pasa a ser org_admin de esta organización (acceso a todos sus experimentos). Si no tiene
          cuenta todavía, le llega un email para que inicie sesión con Google o Microsoft.
        </p>
        <input v-model="orgInviteEmail" class="text-input" type="email" placeholder="Email de la persona a invitar" autofocus />
        <button type="submit" class="primary-btn" :disabled="invitingOrgAdmin || !orgInviteEmail.trim()">Invitar</button>
      </form>
    </Modal>

    <Modal v-if="showExperimentInviteModal" title="Invitar a experimento" @close="showExperimentInviteModal = false">
      <form class="modal-form" @submit.prevent="inviteExperimentMember">
        <p class="hint">Si la persona invitada no tiene cuenta todavía, le llega un email para que inicie sesión con Google o Microsoft.</p>
        <input v-model="experimentInviteEmail" class="text-input" type="email" placeholder="Email de la persona a invitar" autofocus />
        <Select v-model="experimentInviteRole" :options="experimentRoleOptions" />
        <button type="submit" class="primary-btn" :disabled="invitingExperimentMember || !experimentInviteEmail.trim()">Invitar</button>
      </form>
    </Modal>
  </q-page>
</template>

<style scoped>
.page {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  padding: 24px 20px 40px;
  font-family: var(--mt-sans);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.section-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.section-sub {
  margin: 4px 0 0;
  color: var(--mt-muted);
  font-size: 13px;
}

.hint {
  color: var(--mt-muted);
  font-size: 13px;
  margin: 0;
}
.hint code {
  font-family: var(--mt-mono);
  background: var(--mt-soft);
  padding: 1px 5px;
  border-radius: 6px;
  font-size: 12px;
}

/* ---- tarjetas de organización ---- */
.org-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.org-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px 22px 22px;
}
.org-card-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.org-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.org-info h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.org-meta {
  color: var(--mt-muted);
  font-size: 12px;
}

.avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--mt-soft);
  color: var(--mt-accent);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.avatar.small {
  width: 30px;
  height: 30px;
  font-size: 11px;
}
.avatar.pending {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}

.ghost-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: 16px;
  border: 1px solid var(--mt-line);
  background: #fff;
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.ghost-btn:hover {
  color: var(--mt-ink);
  border-color: var(--mt-accent);
}

/* Disclosure: despliega un panel en la misma página (sin abrir modal). Estilo plano + flecha
   que rota, deliberadamente distinto de .ghost-btn (que abre un modal), para que se distinga
   de un vistazo qué es "desplegar aquí" y qué es "abrir un diálogo". */
.chevron-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: var(--mt-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.chevron-btn:hover {
  background: var(--mt-soft-2);
  color: var(--mt-ink);
}
.chevron-btn.open {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.chevron-btn .chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.chevron-btn.open .chevron {
  transform: rotate(90deg);
}
.count-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
}
.count-badge.pending {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}

/* ---- experimentos anidados ---- */
.org-experiments {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--mt-line);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.exp-row {
  border-radius: 14px;
  padding: 6px 8px;
}
.exp-row:hover {
  background: var(--mt-soft-2);
}
.exp-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.exp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.exp-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}
.name {
  font-weight: 600;
  font-size: 13.5px;
}
.service {
  color: var(--mt-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-experiment-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 6px 10px 6px 6px;
  border: none;
  background: transparent;
  color: var(--mt-accent);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 10px;
}
.add-experiment-btn:hover {
  background: var(--mt-soft-2);
}

/* ---- paneles expandibles (miembros, invitaciones, api keys) ---- */
.members-panel {
  margin: 8px 0 4px;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--mt-soft-2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.members-panel.nested {
  margin: 4px 0 10px;
  background: var(--mt-soft);
}
.panel-subtitle {
  margin: 4px 0 0;
  color: var(--mt-muted);
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.member-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 12px;
  background: var(--mt-card);
}
.member-row.pending {
  background: transparent;
  border: 1px dashed var(--mt-line-2);
}
.member-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.member-name {
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-email {
  font-size: 11.5px;
  color: var(--mt-muted);
}

.role-pill {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.role-pill.org_admin {
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
}
.role-pill.admin {
  background: var(--mt-soft);
  color: var(--mt-ink);
}
.role-pill.member {
  background: var(--mt-soft);
  color: var(--mt-muted);
}
.role-pill.outline {
  background: transparent;
  border: 1px solid var(--mt-line-2);
  color: var(--mt-muted);
}

.key-prefix {
  font-weight: 700;
  font-size: 12px;
}
.revoke-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--mt-err-ink);
  background: transparent;
  color: var(--mt-err-ink);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.generate-btn {
  align-self: flex-start;
  height: 34px;
  padding: 0 16px;
  font-size: 12px;
}
.snippet-box {
  position: relative;
  background: var(--code-bg);
  border-radius: 10px;
  padding: 12px 40px 12px 14px;
}
.snippet-box pre {
  margin: 0;
  font-family: var(--mt-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--mt-card);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(20, 60, 35, 0.12);
}

/* ---- directorio global de miembros ---- */
.directory-head {
  margin-top: 8px;
  flex-wrap: wrap;
}
.search-input {
  width: 320px;
  max-width: 100%;
}
.directory-card {
  padding: 8px;
}
.directory-empty {
  padding: 20px 16px;
}
.directory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.directory-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 14px;
}
.directory-row:hover {
  background: var(--mt-soft-2);
}
.directory-row.pending {
  background: var(--mt-soft-2);
}

.scope-pill {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
  max-width: 180px;
}
.scope-pill span,
.scope-pill {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-pill {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.status-pill.active {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.status-pill.pending {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}

/* ---- modales ---- */
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  height: 40px;
  padding: 0 14px;
  border-radius: 20px;
  border: 1px solid #e3eae5;
  background: #fff;
  font: inherit;
  font-size: 13px;
  color: var(--mt-ink);
}
.text-input:focus {
  outline: 2px solid var(--mt-accent);
  outline-offset: -1px;
}
.primary-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 20px;
  border-radius: 20px;
  border: none;
  background: var(--mt-accent);
  color: var(--mt-accent-ink);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary-btn:not(:disabled):hover {
  opacity: 0.9;
}
</style>
