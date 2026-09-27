<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import type { ApiKeyDto, ExperimentDto } from "@/application/identity-api";
import PageHeader from "../components/PageHeader.vue";
import EmptyState from "../components/EmptyState.vue";
import Select from "../components/Select.vue";
import Modal from "../components/Modal.vue";

const api = useIdentityApi();
const $q = useQuasar();

const organizations = useAsync((signal) => api.listOrganizations(signal));
const experiments = useAsync((signal) => api.listExperiments(signal));
void organizations.run();
void experiments.run();

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
    await api.addOrgAdmin(inviteOrgId.value, orgInviteEmail.value.trim());
    showOrgInviteModal.value = false;
    $q.notify({ message: "Invitación enviada", color: "positive", timeout: 2500 });
  } catch (error) {
    notifyError("No se pudo invitar", error);
  } finally {
    invitingOrgAdmin.value = false;
  }
}

const organizationOptions = computed(() => (organizations.data.value ?? []).map((o) => ({ label: o.name, value: o.id })));
const organizationNameById = computed(() => new Map((organizations.data.value ?? []).map((o) => [o.id, o.name])));
const experimentCountByOrgId = computed(() => {
  const counts = new Map<string, number>();
  for (const e of experiments.data.value ?? []) counts.set(e.organizationId, (counts.get(e.organizationId) ?? 0) + 1);
  return counts;
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
function openExperimentModal() {
  selectedOrgId.value = organizationOptions.value[0]?.value ?? null;
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
    await api.addExperimentMember(inviteExperimentId.value, experimentInviteEmail.value.trim(), experimentInviteRole.value);
    showExperimentInviteModal.value = false;
    $q.notify({ message: "Invitación enviada", color: "positive", timeout: 2500 });
  } catch (error) {
    notifyError("No se pudo invitar", error);
  } finally {
    invitingExperimentMember.value = false;
  }
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
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <q-page class="page">
    <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Admin' }]" icon="M4 5h16v11H9l-5 4z" title="Admin" />

    <section class="block">
      <div class="block-header">
        <h2>Organizaciones</h2>
        <button class="primary-btn" type="button" @click="showOrgModal = true">+ Nueva organización</button>
      </div>
      <EmptyState v-if="!organizations.loading.value && !organizations.data.value?.length" icon="apartment" title="Todavía no perteneces a ninguna organización">
        Crea una para empezar — te conviertes en su primer org_admin.
      </EmptyState>
      <ul v-else class="org-list">
        <li v-for="o in organizations.data.value" :key="o.id" class="org-row">
          <span class="name">{{ o.name }}</span>
          <span class="hint">{{ experimentCountByOrgId.get(o.id) ?? 0 }} experimento(s)</span>
          <button class="invite-btn" type="button" @click="openOrgInviteModal(o.id)">+ Invitar org_admin</button>
        </li>
      </ul>
    </section>

    <section class="block">
      <div class="block-header">
        <h2>Experimentos</h2>
        <button
          class="primary-btn"
          type="button"
          :disabled="!organizationOptions.length"
          :title="organizationOptions.length ? undefined : 'Crea antes una organización'"
          @click="openExperimentModal"
        >
          + Nuevo experimento
        </button>
      </div>

      <EmptyState v-if="!experiments.loading.value && !experiments.data.value?.length" icon="folder_open" title="No tienes acceso a ningún experimento todavía">
        Crea uno arriba, o pide a un admin que te invite.
      </EmptyState>
      <ul v-else class="list">
        <li v-for="e in experiments.data.value" :key="e.id">
          <div class="item-row">
            <div class="item-main">
              <span class="name">{{ e.name }}</span>
              <span class="service mono">{{ e.serviceName }}</span>
              <span class="org-badge">{{ organizationNameById.get(e.organizationId) }}</span>
            </div>
            <button class="invite-btn" type="button" @click="openExperimentInviteModal(e.id)">+ Invitar</button>
            <button class="key-toggle-btn" type="button" title="API keys" @click="toggleApiKeys(e.id)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 7a4 4 0 1 0-4 4M11 11l-6 6v3h3l6-6M14 8l2 2" /></svg>
              API key
            </button>
          </div>

          <div v-if="expandedId === e.id" class="api-keys-panel">
            <div v-if="revealedKey?.experimentId === e.id" class="revealed-key">
              <p class="hint">Copia esto ahora — no se volverá a mostrar la key completa.</p>
              <div class="snippet-box">
                <pre>{{ envSnippet(e, revealedKey.plaintext) }}</pre>
                <button class="copy-btn" type="button" @click="copyEnvSnippet(e, revealedKey.plaintext)">Copiar</button>
              </div>
            </div>

            <ul v-if="apiKeysByExperiment[e.id]?.length" class="key-list">
              <li v-for="k in apiKeysByExperiment[e.id]" :key="k.id" class="key-row">
                <span class="mono key-prefix">{{ k.keyPrefix }}…</span>
                <span class="key-meta">creada {{ formatDate(k.createdAt) }} · último uso: {{ formatDate(k.lastUsedAt) }}</span>
                <button class="revoke-btn" type="button" @click="revokeApiKey(e.id, k.id)">Revocar</button>
              </li>
            </ul>
            <p v-else-if="!loadingKeys" class="hint">Sin API keys todavía.</p>

            <button class="primary-btn generate-btn" type="button" :disabled="generatingKey" @click="generateApiKey(e.id)">
              Generar API key
            </button>
          </div>
        </li>
      </ul>
    </section>

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
  padding: 24px 20px 32px;
  font-family: var(--mt-sans);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 22px;
  border-radius: 20px;
  background: var(--mt-soft-2);
}
.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.block-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
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
.org-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.org-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 14px;
}
.org-row:hover {
  background: var(--mt-soft);
}
.invite-btn {
  flex-shrink: 0;
  height: 34px;
  padding: 0 12px;
  border-radius: 17px;
  border: 1px solid #e3eae5;
  background: #fff;
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.invite-btn:hover {
  color: var(--mt-ink);
  border-color: var(--mt-accent);
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.key-toggle-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: 17px;
  border: 1px solid #e3eae5;
  background: #fff;
  color: var(--mt-muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.key-toggle-btn:hover {
  color: var(--mt-ink);
  border-color: var(--mt-accent);
}
.api-keys-panel {
  margin: 4px 8px 12px;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--mt-card);
  display: flex;
  flex-direction: column;
  gap: 10px;
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
.key-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.key-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.key-prefix {
  font-weight: 700;
}
.key-meta {
  color: var(--mt-muted);
  flex: 1;
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
.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px 16px;
  color: var(--mt-ink);
}
.name {
  font-weight: 600;
  font-size: 14px;
}
.service {
  color: var(--mt-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-badge {
  flex-shrink: 0;
  margin-left: auto;
  padding: 2px 10px;
  border-radius: 10px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 600;
}
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
