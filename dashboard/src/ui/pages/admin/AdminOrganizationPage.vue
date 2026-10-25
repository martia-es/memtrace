<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from "vue";
import { useQuasar } from "quasar";
import { useRoute, useRouter } from "vue-router";
import "@/styles/admin.css";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { canManageOrg, notifyErrorWith, ROLE_LABEL, useAdminDirectory, roleTone } from "../../composables/useAdminDirectory";
import PageHeader from "../../components/PageHeader.vue";
import Modal from "../../components/Modal.vue";
import MemberList from "../../components/admin/MemberList.vue";
import InviteForm from "../../components/admin/InviteForm.vue";
import OrganizationAppearance from "../../components/admin/OrganizationAppearance.vue";
import OrganizationIdentity from "../../components/admin/OrganizationIdentity.vue";
import ApprovalRulesPanel from "../../components/admin/ApprovalRulesPanel.vue";
import OrganizationRiskPolicy from "../../components/admin/OrganizationRiskPolicy.vue";
import AuditLogPanel from "../../components/admin/AuditLogPanel.vue";
import OrganizationPartners from "../../components/admin/OrganizationPartners.vue";
import { hasPermission } from "../../composables/usePermissions";
import { useSettingsNav, type SettingsSection } from "../../composables/useSettingsNav";
import Button from "../../components/Button.vue";
import Pill from "../../components/Pill.vue";
import LoadingState from "../../components/LoadingState.vue";
import { t } from "../../i18n";

/** Nivel 2: una organización. Secciones en el menú lateral (`?tab=` en la URL): experimentos siempre; el resto solo para org_admin. */
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
// protección de datos (ADR-084): retención y registro de auditoría, cada uno con su permiso
const canRetention = computed(() => hasPermission(organization.value, "retention:manage"));
const canGovernanceRead = computed(() => hasPermission(organization.value, "governance:read"));
const canGovernanceManage = computed(() => hasPermission(organization.value, "governance:manage"));
const canAudit = computed(() => hasPermission(organization.value, "audit:read"));

const ICONS = {
  experiments: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3",
  members: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  approvals: "M9 12l2 2 4-4M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  risk: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v4M12 16h.01",
  data: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  partners: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  identity: "M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4M5 17c0-2 1.5-3 3-3s3 1 3 3M14 9h4M14 13h4",
  appearance: "M4 20c3 0 5-1 5-4a3 3 0 0 1 6 0c0 3-4 4-11 4zM15 10l5-6",
};
const sections = computed<SettingsSection[]>(() => {
  const list: SettingsSection[] = [{ id: "experiments", label: t("adminOrganizationPage.experiments"), icon: ICONS.experiments, group: t("adminOrganizationPage.workspace"), count: orgExperiments.value.length }];
  if (isOrgAdmin.value) {
    list.push({ id: "members", label: t("adminOrganizationPage.members"), icon: ICONS.members, group: t("adminOrganizationPage.workspace"), count: (orgMembers.value?.members.length ?? 0) + (orgMembers.value?.pendingInvitations.length ?? 0) });
    list.push({ id: "approvals", label: t("adminOrganizationPage.approvals"), icon: ICONS.approvals, group: t("adminOrganizationPage.governance") });
    if (canRetention.value || canGovernanceRead.value) list.push({ id: "risk", label: t("adminOrganizationPage.risk_retention"), icon: ICONS.risk, group: t("adminOrganizationPage.governance") });
    if (canAudit.value) list.push({ id: "data", label: t("adminOrganizationPage.data_protection"), icon: ICONS.data, group: t("adminOrganizationPage.governance") });
    list.push({ id: "partners", label: t("adminOrganizationPage.partners"), icon: ICONS.partners, group: t("adminOrganizationPage.organization") });
    list.push({ id: "identity", label: t("adminOrganizationPage.identity"), icon: ICONS.identity, group: t("adminOrganizationPage.organization") });
    list.push({ id: "appearance", label: t("adminOrganizationPage.appearance"), icon: ICONS.appearance, group: t("adminOrganizationPage.organization") });
  }
  return list;
});
const tab = computed(() => sections.value.find((t) => t.id === route.query.tab)?.id ?? "experiments");

// MainLayout sustituye el menú principal por estas secciones mientras la página esté montada
const { settingsNav } = useSettingsNav();
watchEffect(() => {
  settingsNav.value = organization.value ? { title: organization.value.name, sections: sections.value } : null;
});
onBeforeUnmount(() => (settingsNav.value = null));

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
    notifyErrorWith($q.notify, t("adminOrganizationPage.could_not_create_experiment"), error);
  } finally {
    creating.value = false;
  }
}

// ---- miembros de la organización ----
async function inviteOrgAdmin({ email }: { email: string }) {
  try {
    await api.addOrgAdmin(props.organizationId, email);
    $q.notify({ message: t("adminOrganizationPage.invitation_sent"), color: "positive", timeout: 2500 });
    await dir.reload();
  } catch (error) {
    notifyErrorWith($q.notify, t("adminOrganizationPage.could_not_invite"), error);
  }
}
</script>

<template>
  <q-page>
    <LoadingState v-if="!loaded" fill data-testid="org-loading" />
    <div v-else class="adm-page">
      <PageHeader
        :crumbs="[{ label: 'MemTrace' }, { label: 'Admin', to: { name: 'admin' } }, { label: organization?.name ?? 'Organization' }]"
        icon="M3 21h18M5 21V7l7-4 7 4v14"
        :title="organization?.name ?? t('adminOrganizationPage.organization')"
      />

      <p v-if="loaded && !organization" class="adm-empty">
        {{ t("adminOrganizationPage.this_organization_doesn_t_exist_or") }}
        <router-link :to="{ name: 'admin' }">{{ t("adminOrganizationPage.back_to_organizations") }}</router-link>
      </p>

      <template v-else-if="organization">
        <p class="adm-sub">
          <template v-if="isOrgAdmin">{{ t("adminOrganizationPage.as_org_admin_you_manage_every") }}</template>
          <template v-else>{{ t("adminOrganizationPage.you_have_access_to_the_experiments") }}</template>
        </p>

        <section v-if="tab === 'experiments'" class="adm-card panel">
          <div class="adm-toolbar">
            <div>
              <h3 class="adm-section-title">{{ t("adminOrganizationPage.experiments") }}</h3>
              <p class="adm-hint">{{ t("adminOrganizationPage.an_experiment_is_one_agent_open") }}</p>
            </div>
            <Button variant="primary" v-if="isOrgAdmin" @click="showCreate = true" class="mt-new">{{ t("adminOrganizationPage.new_experiment") }}</Button>
          </div>

          <ul v-if="orgExperiments.length" class="exp-grid">
            <li v-for="e in orgExperiments" :key="e.id">
              <router-link class="exp-card" :to="{ name: 'admin-experiment', params: { expId: e.id } }">
                <div class="exp-head">
                  <span class="exp-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path :d="ICONS.experiments" /></svg>
                  </span>
                  <div class="exp-id">
                    <span class="exp-title">{{ e.name }}</span>
                    <span class="exp-meta">{{ t("adminOrganizationPage.service_name") + " " }}<span class="mono">{{ e.serviceName }}</span></span>
                  </div>
                </div>
                <div class="exp-foot">
                  <Pill :tone="roleTone(e.myRole)">{{ ROLE_LABEL[e.myRole] }}</Pill>
                  <span class="exp-open" aria-hidden="true">Open <span class="exp-arrow">→</span></span>
                </div>
              </router-link>
            </li>
          </ul>
          <p v-else class="adm-empty">
            {{ t("adminOrganizationPage.no_experiments_yet") }}
            <template v-if="isOrgAdmin">{{ t("adminOrganizationPage.create_the_first_one_named_after") + " " }}<span class="mono">service.name</span>.</template>
          </p>
        </section>

        <section v-if="tab === 'members' && isOrgAdmin" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">{{ t("adminOrganizationPage.organization_admins") }}</h3>
            <p class="adm-hint">{{ t("adminOrganizationPage.org_admins_have_access_to_all") }}</p>
            <MemberList :data="orgMembers" />
          </div>
          <InviteForm
            :title="t('adminOrganizationPage.invite_an_org_admin')"
            help="The invited person gets access to every experiment here. If they don't have an account yet, they'll receive an email to sign in with Google or Microsoft."
            @invite="inviteOrgAdmin"
          />
        </section>

        <section v-if="tab === 'approvals' && isOrgAdmin" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">{{ t("adminOrganizationPage.approvals_for_prompt_changes") }}</h3>
            <p class="adm-hint">
              {{ t("adminOrganizationPage.decide_which_changes_to_a_prompt") + " " }}<span class="mono">{{ t("adminOrganizationPage.dev") }}</span>{{ t("adminOrganizationPage.a_technical_and_a_business_person") + " " }}<span class="mono">{{ t("adminOrganizationPage.pro") }}</span>.
            </p>
            <ApprovalRulesPanel :scope="{ type: 'organization', id: organizationId }" />
          </div>
        </section>

        <section v-if="tab === 'risk' && organization && isOrgAdmin" class="panel">
          <OrganizationRiskPolicy :organization="organization" :can-classify="canGovernanceManage" :can-edit-retention="canRetention" :can-lower="isOrgAdmin" />
        </section>

        <section v-if="tab === 'data' && organization && isOrgAdmin" class="panel">
          <p class="adm-hint" data-testid="retention-moved">
            {{ t("adminOrganizationPage.trace_retention_is_set_by_risk_level_in") + " " }}<router-link :to="{ name: 'admin-organization', params: { organizationId }, query: { tab: 'risk' } }">{{ t("adminOrganizationPage.risk_retention") }}</router-link>.
          </p>
          <AuditLogPanel v-if="canAudit" :organization="organization" :experiments="orgExperiments" />
        </section>

        <section v-if="tab === 'partners' && organization && isOrgAdmin" class="panel">
          <OrganizationPartners :organization="organization" :experiments="orgExperiments" />
        </section>

        <section v-if="tab === 'identity' && organization && isOrgAdmin" class="panel">
          <OrganizationIdentity :organization="organization" :experiments="orgExperiments" />
        </section>

        <section v-if="tab === 'appearance' && organization && isOrgAdmin" class="panel">
          <OrganizationAppearance :organization="organization" :can-manage="isOrgAdmin" @saved="dir.reload" />
        </section>
      </template>
    </div>

    <Modal v-if="showCreate" :title="t('adminOrganizationPage.new_experiment_agent')" @close="showCreate = false">
      <form class="adm-form" @submit.prevent="createExperiment">
        <p class="adm-hint">
          {{ t("adminOrganizationPage.an_experiment_is_one_agent_it") + " " }}<router-link :to="{ name: 'assistants' }">{{ t("adminOrganizationPage.assistants_catalog") }}</router-link>{{ " " + t("adminOrganizationPage.as_soon_as_you_create_it") + " " }}<span class="mono">service.name</span>{{ " " + t("adminOrganizationPage.must_be_the_same_value_the") + " " }}<span class="mono">MEMTRACE_SERVICE_NAME</span>{{ t("adminOrganizationPage.the_display_name_is_only_for") }}
        </p>
        <TextInput mono v-model="serviceName" :placeholder="t('adminOrganizationPage.service_name_e_g_support_agent')" autofocus @input="onServiceInput" />
        <TextInput v-model="displayName" :placeholder="t('adminOrganizationPage.display_name')" @input="displayTouched = true" />
        <TextInput multiline v-model="description" :rows="2" :placeholder="t('adminOrganizationPage.what_does_this_agent_do_and')" />
        <Button variant="primary" type="submit" :disabled="creating || !serviceName.trim() || !displayName.trim()">{{ t("adminOrganizationPage.create_experiment") }}</Button>
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
.exp-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.exp-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  height: 100%;
  padding: 18px 20px;
  border: 1px solid var(--mt-line-2);
  border-radius: var(--mt-radius-lg);
  background: linear-gradient(145deg, color-mix(in srgb, var(--mt-accent) 9%, var(--mt-card)), var(--mt-card) 62%);
  color: inherit;
  text-decoration: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.exp-card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: linear-gradient(90deg, var(--mt-accent), #ff6b4a);
  opacity: 0.85;
}
.exp-card:hover {
  transform: translateY(-3px);
  border-color: var(--mt-accent);
  box-shadow: 0 10px 24px -12px color-mix(in srgb, var(--mt-accent) 55%, transparent);
}
.exp-head {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.exp-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, var(--mt-accent), color-mix(in srgb, var(--mt-accent) 55%, #00b3ad));
}
.exp-id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.exp-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--mt-ink);
  overflow-wrap: anywhere;
}
.exp-meta {
  font-size: 12px;
  color: var(--mt-muted);
  overflow-wrap: anywhere;
}
.exp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.exp-open {
  font-size: 12px;
  font-weight: 600;
  color: var(--mt-accent);
}
.exp-arrow {
  display: inline-block;
  transition: transform 0.15s ease;
}
.exp-card:hover .exp-arrow {
  transform: translateX(4px);
}
@media (prefers-reduced-motion: reduce) {
  .exp-card, .exp-arrow { transition: none; }
  .exp-card:hover { transform: none; }
}
.adm-empty a {
  color: var(--mt-accent);
}
</style>
