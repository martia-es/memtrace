<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import { useRoute, useRouter } from "vue-router";
import "@/styles/admin.css";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { canManageOrg, notifyErrorWith, ROLE_LABEL, useAdminDirectory } from "../../composables/useAdminDirectory";
import PageHeader from "../../components/PageHeader.vue";
import TabBar from "../../components/TabBar.vue";
import Modal from "../../components/Modal.vue";
import MemberList from "../../components/admin/MemberList.vue";
import InviteForm from "../../components/admin/InviteForm.vue";
import OrganizationAppearance from "../../components/admin/OrganizationAppearance.vue";
import OrganizationIdentity from "../../components/admin/OrganizationIdentity.vue";
import ApprovalRulesPanel from "../../components/admin/ApprovalRulesPanel.vue";
import OrganizationRetention from "../../components/admin/OrganizationRetention.vue";
import AuditLogPanel from "../../components/admin/AuditLogPanel.vue";
import { hasPermission } from "../../composables/usePermissions";

/** Nivel 2: una organización. Pestañas: experimentos (siempre), y miembros + identidad + apariencia solo para org_admin. */
const props = defineProps<{ organizationId: string }>();

const api = useIdentityApi();
const $q = useQuasar();
const route = useRoute();
const router = useRouter();
const dir = useAdminDirectory();

const loaded = ref(false);
onMounted(async () => {
  await dir.load();
  loaded.value = true;
});

const organization = computed(() => dir.organizations.value.find((o) => o.id === props.organizationId) ?? null);
const isOrgAdmin = computed(() => (organization.value ? canManageOrg(organization.value) : false));
const orgExperiments = computed(() => dir.experiments.value.filter((e) => e.organizationId === props.organizationId));
const orgMembers = computed(() => dir.membersByOrg[props.organizationId]);
// protección de datos (ADR-080): retención y registro de auditoría, cada uno con su permiso
const canRetention = computed(() => hasPermission(organization.value, "retention:manage"));
const canAudit = computed(() => hasPermission(organization.value, "audit:read"));

const tabs = computed(() => {
  const list: { id: string; label: string; count?: number }[] = [{ id: "experiments", label: "Experiments", count: orgExperiments.value.length }];
  if (isOrgAdmin.value) {
    list.push({ id: "members", label: "Members", count: (orgMembers.value?.members.length ?? 0) + (orgMembers.value?.pendingInvitations.length ?? 0) });
    list.push({ id: "approvals", label: "Approvals" });
    if (canRetention.value || canAudit.value) list.push({ id: "data", label: "Data protection" });
    list.push({ id: "identity", label: "Identity" });
    list.push({ id: "appearance", label: "Appearance" });
  }
  return list;
});
const tab = computed({
  get: () => tabs.value.find((t) => t.id === route.query.tab)?.id ?? "experiments",
  set: (id: string) => void router.replace({ query: { ...route.query, tab: id } }),
});

// ---- nueva experimento (creación puntual: modal) ----
const showCreate = ref(false);
const serviceName = ref("");
const displayName = ref("");
const description = ref("");
const displayTouched = ref(false);
const creating = ref(false);
function onServiceInput() {
  if (!displayTouched.value) displayName.value = serviceName.value;
}
async function createExperiment() {
  if (!serviceName.value.trim() || !displayName.value.trim()) return;
  creating.value = true;
  try {
    await api.createExperiment(props.organizationId, displayName.value.trim(), serviceName.value.trim(), { description: description.value.trim() });
    serviceName.value = "";
    displayName.value = "";
    description.value = "";
    displayTouched.value = false;
    showCreate.value = false;
    await dir.reload();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not create experiment", error);
  } finally {
    creating.value = false;
  }
}

// ---- miembros de la organización ----
async function inviteOrgAdmin({ email }: { email: string }) {
  try {
    await api.addOrgAdmin(props.organizationId, email);
    $q.notify({ message: "Invitation sent", color: "positive", timeout: 2500 });
    await dir.reload();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not invite", error);
  }
}
</script>

<template>
  <q-page>
    <div class="adm-page">
      <PageHeader
        :crumbs="[{ label: 'MemTrace' }, { label: 'Admin', to: { name: 'admin' } }, { label: organization?.name ?? 'Organization' }]"
        icon="M3 21h18M5 21V7l7-4 7 4v14"
        :title="organization?.name ?? 'Organization'"
      />

      <p v-if="loaded && !organization" class="adm-empty">
        This organization doesn't exist or you don't have access to it.
        <router-link :to="{ name: 'admin' }">Back to organizations</router-link>
      </p>

      <template v-else-if="organization">
        <p class="adm-sub">
          <template v-if="isOrgAdmin">As org_admin you manage every experiment here and who can invite others.</template>
          <template v-else>You have access to the experiments below through your own membership. Only an org_admin can change the organization.</template>
        </p>

        <TabBar v-model="tab" :tabs="tabs" />

        <section v-if="tab === 'experiments'" class="adm-card panel">
          <div class="adm-toolbar">
            <div>
              <h3 class="adm-section-title">Experiments</h3>
              <p class="adm-hint">An experiment is one agent. Open one to connect it, manage its keys, score configs and members.</p>
            </div>
            <button v-if="isOrgAdmin" class="adm-btn primary mt-new" type="button" @click="showCreate = true">+ New experiment</button>
          </div>

          <ul v-if="orgExperiments.length" class="adm-list">
            <li v-for="e in orgExperiments" :key="e.id">
              <router-link class="adm-item" :to="{ name: 'admin-experiment', params: { expId: e.id } }">
                <div class="adm-item-main">
                  <span class="adm-item-title">{{ e.name }}</span>
                  <span class="adm-item-meta">service.name: <span class="mono">{{ e.serviceName }}</span></span>
                </div>
                <span class="adm-pill" :class="e.myRole">{{ ROLE_LABEL[e.myRole] }}</span>
                <span class="chevron" aria-hidden="true">›</span>
              </router-link>
            </li>
          </ul>
          <p v-else class="adm-empty">
            No experiments yet.
            <template v-if="isOrgAdmin">Create the first one, named after the agent's <span class="mono">service.name</span>.</template>
          </p>
        </section>

        <section v-if="tab === 'members' && isOrgAdmin" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">Organization admins</h3>
            <p class="adm-hint">org_admins have access to all experiments in this organization.</p>
            <MemberList :data="orgMembers" />
          </div>
          <InviteForm
            title="Invite an org_admin"
            help="The invited person gets access to every experiment here. If they don't have an account yet, they'll receive an email to sign in with Google or Microsoft."
            @invite="inviteOrgAdmin"
          />
        </section>

        <section v-if="tab === 'approvals' && isOrgAdmin" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">Approvals for prompt changes</h3>
            <p class="adm-hint">
              Decide which changes to a prompt need a second opinion before they happen, and from whom. It is optional and set per step: for example,
              one technical person to move <span class="mono">dev</span>, a technical and a business person to reach <span class="mono">pro</span>.
            </p>
            <ApprovalRulesPanel :scope="{ type: 'organization', id: organizationId }" />
          </div>
        </section>

        <section v-if="tab === 'data' && organization && isOrgAdmin" class="panel">
          <OrganizationRetention v-if="canRetention" :organization="organization" />
          <AuditLogPanel v-if="canAudit" :organization="organization" :experiments="orgExperiments" />
        </section>

        <section v-if="tab === 'identity' && organization && isOrgAdmin" class="panel">
          <OrganizationIdentity :organization="organization" :experiments="orgExperiments" />
        </section>

        <section v-if="tab === 'appearance' && organization && isOrgAdmin" class="panel">
          <OrganizationAppearance :organization="organization" :can-manage="isOrgAdmin" @saved="dir.reload" />
        </section>
      </template>
    </div>

    <Modal v-if="showCreate" title="New experiment (agent)" @close="showCreate = false">
      <form class="adm-form" @submit.prevent="createExperiment">
        <p class="adm-hint">
          An experiment is one agent: it appears in the <router-link :to="{ name: 'assistants' }">Assistants catalog</router-link> as soon as you create it, with you as its owner.
          The <span class="mono">service.name</span> must be the same value the agent uses in <span class="mono">MEMTRACE_SERVICE_NAME</span>.
          The display name is only for this dashboard.
        </p>
        <TextInput mono v-model="serviceName" placeholder="service.name, e.g. support-agent" autofocus @input="onServiceInput" />
        <TextInput v-model="displayName" placeholder="Display name" @input="displayTouched = true" />
        <TextInput multiline v-model="description" :rows="2" placeholder="What does this agent do, and for whom? (optional)" />
        <button type="submit" class="adm-btn primary" :disabled="creating || !serviceName.trim() || !displayName.trim()">Create experiment</button>
      </form>
    </Modal>
  </q-page>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.adm-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.adm-section-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
  color: var(--mt-ink);
}
.mono {
  font-family: var(--mt-mono);
}
.chevron {
  color: var(--mt-muted);
  font-size: 18px;
}
.adm-empty a {
  color: var(--mt-accent);
}
</style>
