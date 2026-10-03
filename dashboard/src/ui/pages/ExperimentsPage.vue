<script setup lang="ts">
import { computed, inject, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import { applyOrganizationTheme } from "../composables/useOrganizationTheme";
import type { ApiKeyDto, ExperimentDto, MembersResponseDto, OrganizationDto, OrganizationThemeDto } from "@/application/identity-api";
import { CURRENT_EXPERIMENT } from "@/dependency-container";
import PageHeader from "../components/PageHeader.vue";
import EmptyState from "../components/EmptyState.vue";
import Select from "../components/Select.vue";
import Modal from "../components/Modal.vue";
import ScoreConfigsPanel from "../components/ScoreConfigsPanel.vue";

const api = useIdentityApi();
const $q = useQuasar();
// no provisto cuando /admin es la ruta de entrada (sin :experimentId todavía) — de ahí el fallback
const currentExperiment = inject(CURRENT_EXPERIMENT, computed(() => null));

const organizations = useAsync((signal) => api.listOrganizations(signal));
const experiments = useAsync((signal) => api.listExperiments(signal));

// Member/invitation counts must be visible without expanding each row:
// they're all loaded as soon as we have organizations and experiments, not on click.
const membersLoaded = ref(false);
async function bootstrap() {
  await Promise.all([organizations.run(), experiments.run()]);
  await refreshAllMembers();
  membersLoaded.value = true;
}
void bootstrap();

async function refreshAllMembers() {
  // Viewing the member list requires being able to manage them (ADR-016): a member only sees their own,
  // so we don't even try it for orgs/experiments where they aren't org_admin/admin (avoids cascading 403s).
  await Promise.all([
    ...(organizations.data.value ?? []).filter(canManageOrg).map(async (o) => {
      membersByOrg[o.id] = await api.listOrgMembers(o.id);
    }),
    ...(experiments.data.value ?? []).filter(canManageExperiment).map(async (e) => {
      membersByExperiment[e.id] = await api.listExperimentMembers(e.id);
    }),
  ]);
}

// ---- per-row permissions (ADR-016): admin always sees everything, member only reads and generates their own API key ----
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

// ---- organizations ----
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
    notifyError("Could not create organization", error);
  } finally {
    creatingOrg.value = false;
  }
}

// ---- invite org_admin ----
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
    $q.notify({ message: "Invitation sent", color: "positive", timeout: 2500 });
    membersByOrg[organizationId] = await api.listOrgMembers(organizationId);
    expandedOrgMembersId.value = organizationId;
  } catch (error) {
    notifyError("Could not invite", error);
  } finally {
    invitingOrgAdmin.value = false;
  }
}

// ---- organization members and pending invitations (preloaded, see bootstrap) ----
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

// ---- appearance (ADR-019): accent color + border-radius preset, per organization ----
const RADIUS_OPTIONS = [
  { label: "Sharp", value: "sharp" as const },
  { label: "Soft", value: "soft" as const },
  { label: "Round", value: "round" as const },
];
const DEFAULT_ACCENT = "#1c1f23";
const expandedThemeId = ref<string | null>(null);
const themeDraft = reactive<Record<string, OrganizationThemeDto>>({});
const savingTheme = ref(false);

function toggleTheme(organizationId: string) {
  if (expandedThemeId.value === organizationId) {
    expandedThemeId.value = null;
    return;
  }
  const current = (organizations.data.value ?? []).find((o) => o.id === organizationId)?.theme;
  themeDraft[organizationId] = { accentColor: current?.accentColor ?? null, radiusPreset: current?.radiusPreset ?? null };
  expandedThemeId.value = organizationId;
}

async function saveTheme(organizationId: string) {
  const draft = themeDraft[organizationId];
  if (!draft) return;
  savingTheme.value = true;
  try {
    const updated = await api.updateOrganizationTheme(organizationId, draft);
    await organizations.run();
    // feedback inmediato solo si la org editada es la del experimento activo (si no, MainLayout
    // ya la reaplicará solo con el valor correcto en cuanto se navegue a un experimento suyo)
    if (currentExperiment.value?.organizationId === organizationId) applyOrganizationTheme(updated.theme);
    $q.notify({ message: "Appearance updated", color: "positive", timeout: 2000 });
  } catch (error) {
    notifyError("Could not update appearance", error);
  } finally {
    savingTheme.value = false;
  }
}

function resetTheme(organizationId: string) {
  themeDraft[organizationId] = { accentColor: null, radiusPreset: null };
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

// ---- directory: all members and invitations, at a glance, with what they belong to ----
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

// ---- experiments ----
const showExperimentModal = ref(false);
const selectedOrgId = ref<string | null>(null);
const newServiceName = ref("");
const newExperimentName = ref("");
const experimentNameTouched = ref(false);
// by default the display name matches the service.name: they're the same thing until the user edits it manually
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
    notifyError("Could not create experiment", error);
  } finally {
    creatingExperiment.value = false;
  }
}

// ---- invite to experiment ----
const showExperimentInviteModal = ref(false);
const inviteExperimentId = ref<string | null>(null);
const experimentInviteEmail = ref("");
const experimentInviteRole = ref<"admin" | "member">("member");
const invitingExperimentMember = ref(false);
const experimentRoleOptions = [
  { label: "member (read-only)", value: "member" as const },
  { label: "admin (can invite)", value: "admin" as const },
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
    $q.notify({ message: "Invitation sent", color: "positive", timeout: 2500 });
    membersByExperiment[experimentId] = await api.listExperimentMembers(experimentId);
    expandedMembersId.value = experimentId;
  } catch (error) {
    notifyError("Could not invite", error);
  } finally {
    invitingExperimentMember.value = false;
  }
}

// ---- experiment members and pending invitations (preloaded, see bootstrap) ----
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

// ---- score configs (ADR-036): visible to every member, editable only by admins ----
const expandedScoreConfigsId = ref<string | null>(null);
function toggleScoreConfigs(experimentId: string) {
  expandedScoreConfigsId.value = expandedScoreConfigsId.value === experimentId ? null : experimentId;
}

// ---- API keys (ADR-013, piece 9) ----
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
    notifyError("Could not load API keys", error);
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
    notifyError("Could not generate API key", error);
  } finally {
    generatingKey.value = false;
  }
}

async function revokeApiKey(experimentId: string, keyId: string) {
  try {
    await api.revokeApiKey(experimentId, keyId);
    apiKeysByExperiment[experimentId] = await api.listApiKeys(experimentId);
  } catch (error) {
    notifyError("Could not revoke API key", error);
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
  $q.notify({ message: "Copied", timeout: 1200, position: "bottom" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Admin' }]" icon="M4 5h16v11H9l-5 4z" title="Admin" />

    <section class="section-head">
      <div>
        <h2>Organizations</h2>
        <p class="section-sub">Each organization groups its experiments and the members with access to them.</p>
      </div>
      <button class="primary-btn" type="button" @click="showOrgModal = true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        New organization
      </button>
    </section>

    <EmptyState v-if="!organizations.loading.value && !organizations.data.value?.length" icon="apartment" title="You don't have access to any organization or experiment yet">
      Create an organization to get started — you'll become its first org_admin.
    </EmptyState>

    <div v-else class="org-grid">
      <article v-for="o in organizations.data.value" :key="o.id" class="org-card mt-card">
        <header class="org-card-head">
          <div class="avatar">{{ initials(o.name) }}</div>
          <div class="org-info">
            <h3>{{ o.name }}</h3>
            <span class="org-meta">{{ experimentCountByOrgId.get(o.id) ?? 0 }} experiment(s)</span>
          </div>
          <span v-if="!canManageOrg(o)" class="role-pill member">access via experiment</span>
          <template v-if="canManageOrg(o)">
            <button
              class="chevron-btn"
              type="button"
              :class="{ open: expandedOrgMembersId === o.id }"
              :aria-expanded="expandedOrgMembersId === o.id"
              @click="toggleOrgMembers(o.id)"
            >
              <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              <span v-if="membersLoaded">{{ orgMemberCount(o.id) }} member(s)</span>
              <span v-else>Members</span>
              <span v-if="orgPendingCount(o.id)" class="count-badge pending">{{ orgPendingCount(o.id) }} pending</span>
            </button>
            <button class="ghost-btn" type="button" @click="openOrgInviteModal(o.id)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" /></svg>
              Invite org_admin
            </button>
            <button
              class="chevron-btn"
              type="button"
              :class="{ open: expandedThemeId === o.id }"
              :aria-expanded="expandedThemeId === o.id"
              @click="toggleTheme(o.id)"
            >
              <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              Appearance
            </button>
          </template>
        </header>

        <div v-if="expandedThemeId === o.id && themeDraft[o.id]" class="members-panel theme-panel">
          <div class="theme-row">
            <span class="theme-label">Accent color</span>
            <div class="theme-color-input">
              <input
                type="color"
                :value="themeDraft[o.id]!.accentColor ?? DEFAULT_ACCENT"
                @input="themeDraft[o.id]!.accentColor = ($event.target as HTMLInputElement).value"
              />
              <span class="mono">{{ themeDraft[o.id]!.accentColor ?? "default" }}</span>
            </div>
          </div>
          <div class="theme-row">
            <span class="theme-label">Corner style</span>
            <div class="mt-segmented small">
              <button
                v-for="opt in RADIUS_OPTIONS"
                :key="opt.value"
                type="button"
                :aria-pressed="(themeDraft[o.id]!.radiusPreset ?? 'sharp') === opt.value"
                @click="themeDraft[o.id]!.radiusPreset = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>
          <div class="theme-actions">
            <button class="ghost-btn" type="button" @click="resetTheme(o.id)">Reset to default</button>
            <button class="primary-btn" type="button" :disabled="savingTheme" @click="saveTheme(o.id)">Save</button>
          </div>
        </div>

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
          <p v-else class="hint">No members yet.</p>

          <template v-if="membersByOrg[o.id]?.pendingInvitations.length">
            <p class="panel-subtitle">Pending invitations</p>
            <ul class="member-list">
              <li v-for="inv in membersByOrg[o.id]?.pendingInvitations" :key="inv.id" class="member-row pending">
                <div class="avatar small pending">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                </div>
                <div class="member-info">
                  <span class="member-name">{{ inv.email }}</span>
                  <span class="member-email">sent {{ formatDate(inv.createdAt) }}</span>
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
                  <span v-if="membersLoaded">{{ expMemberCount(e.id) }} member(s)</span>
                  <span v-else>Members</span>
                  <span v-if="expPendingCount(e.id)" class="count-badge pending">{{ expPendingCount(e.id) }} pending</span>
                </button>
                <button class="ghost-btn" type="button" @click="openExperimentInviteModal(e.id)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" /></svg>
                  Invite
                </button>
              </template>
              <button class="chevron-btn" type="button" :class="{ open: expandedScoreConfigsId === e.id }" :aria-expanded="expandedScoreConfigsId === e.id" @click="toggleScoreConfigs(e.id)">
                <svg class="chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                Score configs
              </button>
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
              <p v-else class="hint">No members yet.</p>

              <template v-if="membersByExperiment[e.id]?.pendingInvitations.length">
                <p class="panel-subtitle">Pending invitations</p>
                <ul class="member-list">
                  <li v-for="inv in membersByExperiment[e.id]?.pendingInvitations" :key="inv.id" class="member-row pending">
                    <div class="avatar small pending">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
                    </div>
                    <div class="member-info">
                      <span class="member-name">{{ inv.email }}</span>
                      <span class="member-email">sent {{ formatDate(inv.createdAt) }}</span>
                    </div>
                    <span class="role-pill outline" :class="inv.role">{{ ROLE_LABEL[inv.role] }}</span>
                  </li>
                </ul>
              </template>
            </div>

            <div v-if="expandedScoreConfigsId === e.id" class="members-panel nested">
              <ScoreConfigsPanel :experiment-id="e.id" :can-manage="canManageExperiment(e)" />
            </div>

            <div v-if="expandedId === e.id" class="members-panel nested">
              <div v-if="revealedKey?.experimentId === e.id" class="revealed-key">
                <p class="hint">Copy this now — the full key won't be shown again.</p>
                <div class="snippet-box">
                  <pre>{{ envSnippet(e, revealedKey.plaintext) }}</pre>
                  <button class="copy-btn" type="button" @click="copyEnvSnippet(e, revealedKey.plaintext)">Copy</button>
                </div>
              </div>

              <ul v-if="apiKeysByExperiment[e.id]?.length" class="member-list">
                <li v-for="k in apiKeysByExperiment[e.id]" :key="k.id" class="member-row">
                  <span class="mono key-prefix">{{ k.keyPrefix }}…</span>
                  <span class="member-email">created {{ formatDate(k.createdAt) }} · last used: {{ formatDate(k.lastUsedAt) }}</span>
                  <button v-if="canManageExperiment(e)" class="revoke-btn" type="button" @click="revokeApiKey(e.id, k.id)">Revoke</button>
                </li>
              </ul>
              <p v-else-if="!loadingKeys" class="hint">No API keys yet.</p>

              <button class="primary-btn generate-btn" type="button" :disabled="generatingKey" @click="generateApiKey(e.id)">
                Generate API key
              </button>
            </div>
          </div>

          <button v-if="canManageOrg(o)" class="add-experiment-btn" type="button" @click="openExperimentModal(o.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New experiment in {{ o.name }}
          </button>
        </div>
      </article>
    </div>

    <section class="section-head directory-head">
      <div>
        <h2>All members</h2>
        <p class="section-sub">A single list of who has access to what, and which invitations are still pending.</p>
      </div>
      <input v-model="directoryFilter" class="text-input search-input" type="search" placeholder="Search by name, email, or organization/experiment…" />
    </section>

    <div class="mt-card directory-card">
      <p v-if="!membersLoaded" class="hint directory-empty">Loading…</p>
      <p v-else-if="!filteredDirectoryRows.length" class="hint directory-empty">No results.</p>
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
          <span v-if="row.status === 'pending'" class="status-pill pending">pending · {{ formatDate(row.date) }}</span>
          <span v-else class="status-pill active">active</span>
        </li>
      </ul>
    </div>

    <Modal v-if="showOrgModal" title="New organization" @close="showOrgModal = false">
      <form class="modal-form" @submit.prevent="createOrganization">
        <p class="hint">Creating it makes you its first org_admin.</p>
        <input v-model="newOrgName" class="text-input" placeholder="Organization name" autofocus />
        <button type="submit" class="primary-btn" :disabled="creatingOrg || !newOrgName.trim()">Create</button>
      </form>
    </Modal>

    <Modal v-if="showExperimentModal" title="New experiment" @close="showExperimentModal = false">
      <form class="modal-form" @submit.prevent="createExperiment">
        <p class="hint">
          Requires being org_admin of the chosen organization. An experiment is an agent's traces + dashboard: its
          <code>service.name</code> is the same value you configure as <code>MEMTRACE_SERVICE_NAME</code> when instrumenting it.
        </p>
        <Select v-model="selectedOrgId" :options="organizationOptions" placeholder="Organization…" />
        <input v-model="newServiceName" class="text-input mono" placeholder="service.name (e.g. my-agent)" @input="onServiceNameInput" />
        <input v-model="newExperimentName" class="text-input" placeholder="Display name" @input="experimentNameTouched = true" />
        <button type="submit" class="primary-btn" :disabled="creatingExperiment || !selectedOrgId || !newExperimentName.trim() || !newServiceName.trim()">
          Create
        </button>
      </form>
    </Modal>

    <Modal v-if="showOrgInviteModal" title="Invite org_admin" @close="showOrgInviteModal = false">
      <form class="modal-form" @submit.prevent="inviteOrgAdmin">
        <p class="hint">
          The invited person becomes org_admin of this organization (access to all its experiments). If they don't
          have an account yet, they'll receive an email to sign in with Google or Microsoft.
        </p>
        <input v-model="orgInviteEmail" class="text-input" type="email" placeholder="Email of the person to invite" autofocus />
        <button type="submit" class="primary-btn" :disabled="invitingOrgAdmin || !orgInviteEmail.trim()">Invite</button>
      </form>
    </Modal>

    <Modal v-if="showExperimentInviteModal" title="Invite to experiment" @close="showExperimentInviteModal = false">
      <form class="modal-form" @submit.prevent="inviteExperimentMember">
        <p class="hint">If the invited person doesn't have an account yet, they'll receive an email to sign in with Google or Microsoft.</p>
        <input v-model="experimentInviteEmail" class="text-input" type="email" placeholder="Email of the person to invite" autofocus />
        <Select v-model="experimentInviteRole" :options="experimentRoleOptions" />
        <button type="submit" class="primary-btn" :disabled="invitingExperimentMember || !experimentInviteEmail.trim()">Invite</button>
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
  border-radius: var(--mt-radius-sm);
  font-size: 12px;
}

/* ---- organization cards ---- */
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
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
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

/* Disclosure: expands a panel in the same page (no modal). Flat style + rotating arrow,
   deliberately distinct from .ghost-btn (which opens a modal), so it's clear at a glance
   what "expand here" is versus what "open a dialog" is. */
.chevron-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--mt-radius-lg);
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
  border-radius: var(--mt-radius-sm);
  font-size: 10.5px;
  font-weight: 700;
}
.count-badge.pending {
  background: var(--mt-warn-bg);
  color: var(--mt-warn-ink);
}

/* ---- nested experiments ---- */
.org-experiments {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--mt-line);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.exp-row {
  border-radius: var(--mt-radius-lg);
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
  border-radius: var(--mt-radius-sm);
}
.add-experiment-btn:hover {
  background: var(--mt-soft-2);
}

/* ---- expandable panels (members, invitations, api keys) ---- */
.members-panel {
  margin: 8px 0 4px;
  padding: 14px 16px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-soft-2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.members-panel.nested {
  margin: 4px 0 10px;
  background: var(--mt-soft);
}
.theme-panel {
  gap: 14px;
}
.theme-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.theme-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mt-ink);
}
.theme-color-input {
  display: flex;
  align-items: center;
  gap: 8px;
}
.theme-color-input input[type="color"] {
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: none;
  cursor: pointer;
}
.theme-color-input .mono {
  font-size: 12px;
  color: var(--mt-muted);
}
.theme-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
  border-radius: var(--mt-radius-lg);
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
  border-radius: var(--mt-radius-sm);
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
  border-radius: var(--mt-radius-sm);
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
  border-radius: var(--mt-radius-sm);
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
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(20, 60, 35, 0.12);
}

/* ---- global member directory ---- */
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
  border-radius: var(--mt-radius-lg);
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
  border-radius: var(--mt-radius-sm);
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
  border-radius: var(--mt-radius-sm);
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

/* ---- modals ---- */
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
  border-radius: var(--mt-radius-lg);
  border: 1px solid var(--mt-line);
  background: var(--mt-card);
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
  border-radius: var(--mt-radius-lg);
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
