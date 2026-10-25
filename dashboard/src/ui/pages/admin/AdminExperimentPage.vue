<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import { useRoute, useRouter } from "vue-router";
import "@/styles/admin.css";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { hasPermission } from "../../composables/usePermissions";
import { canManageExperiment, canUseApiKeys, notifyErrorWith, ROLE_LABEL, useAdminDirectory, roleTone } from "../../composables/useAdminDirectory";
import PageHeader from "../../components/PageHeader.vue";
import TabBar from "../../components/TabBar.vue";
import ScoreConfigsPanel from "../../components/ScoreConfigsPanel.vue";
import MemberList from "../../components/admin/MemberList.vue";
import InviteForm from "../../components/admin/InviteForm.vue";
import ExperimentApiKeys from "../../components/admin/ExperimentApiKeys.vue";
import ApprovalRulesPanel from "../../components/admin/ApprovalRulesPanel.vue";
import ExperimentExport from "../../components/admin/ExperimentExport.vue";
import Button from "../../components/Button.vue";
import Pill from "../../components/Pill.vue";
import { t } from "../../i18n";

/**
 * Nivel 3: un experimento. Un paso por pestaña, en el orden en que se configura un agente:
 * Connect (qué poner en el agente) → API keys (la credencial) → Score configs (qué se evalúa) → Members (quién ve).
 */
const props = defineProps<{ experimentId: string }>();

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

const experiment = computed(() => dir.experiments.value.find((e) => e.id === props.experimentId) ?? null);
const organization = computed(() => dir.organizations.value.find((o) => o.id === experiment.value?.organizationId) ?? null);
const canManage = computed(() => (experiment.value ? canManageExperiment(experiment.value) : false));
const canKeys = computed(() => (experiment.value ? canUseApiKeys(experiment.value) : false));
const canScoreConfigs = computed(() => hasPermission(experiment.value, "scoreconfig:manage"));
const canApprovals = computed(() => hasPermission(experiment.value, "approval:manage"));
const canExport = computed(() => hasPermission(experiment.value, "data:export"));
const members = computed(() => dir.membersByExperiment[props.experimentId]);

const keyCount = ref<number | null>(null);
async function refreshKeyCount() {
  try {
    keyCount.value = (await api.listApiKeys(props.experimentId)).length;
  } catch {
    keyCount.value = null;
  }
}
onMounted(refreshKeyCount);

const tabs = computed(() => {
  const list: { id: string; label: string; count?: number }[] = [
    { id: "connect", label: t("adminExperimentPage.connect") },
    { id: "keys", label: t("adminExperimentPage.api_keys"), count: keyCount.value ?? undefined },
    { id: "score-configs", label: t("adminExperimentPage.score_configs") },
  ];
  if (canApprovals.value) list.push({ id: "approvals", label: t("adminExperimentPage.approvals") });
  if (canExport.value) list.push({ id: "export", label: t("adminExperimentPage.export") });
  if (canManage.value) {
    list.push({ id: "members", label: t("adminExperimentPage.members"), count: (members.value?.members.length ?? 0) + (members.value?.pendingInvitations.length ?? 0) });
  }
  return list;
});
const tab = computed({
  get: () => tabs.value.find((t) => t.id === route.query.tab)?.id ?? "connect",
  set: (id: string) => void router.replace({ query: { ...route.query, tab: id } }),
});

const envTemplate = computed(
  () => `MEMTRACE_SERVICE_NAME="${experiment.value?.serviceName ?? ""}"
MEMTRACE_OTLP_PROTOCOL="http"
MEMTRACE_OTLP_ENDPOINT="${window.location.origin}/api/v1/ingest"
MEMTRACE_OTLP_HEADERS="Authorization=Bearer <your-api-key>"
MEMTRACE_CAPTURE_CONTENT="true"`,
);
function copyTemplate() {
  void navigator.clipboard.writeText(envTemplate.value);
  $q.notify({ message: t("adminExperimentPage.copied"), timeout: 1200, position: "bottom" });
}

async function inviteMember({ email, role }: { email: string; role: string }) {
  try {
    await api.addExperimentMember(props.experimentId, email, role);
    $q.notify({ message: t("adminExperimentPage.invitation_sent"), color: "positive", timeout: 2500 });
    await dir.reload();
  } catch (error) {
    notifyErrorWith($q.notify, t("adminExperimentPage.could_not_invite"), error);
  }
}

const MEMBER_ROLE_OPTIONS = [
  { get label() { return t("adminExperimentPage.technical_curates_reviews_rubrics_datase"); }, value: "technical" },
  { get label() { return t("adminExperimentPage.business_sees_the_dashboard_and_labels"); }, value: "business" },
];
</script>

<template>
  <q-page>
    <div class="adm-page">
      <PageHeader
        :crumbs="[
          { label: 'MemTrace' },
          { label: 'Admin', to: { name: 'admin' } },
          { label: organization?.name ?? 'Organization', to: organization ? { name: 'admin-organization', params: { organizationId: organization.id } } : undefined },
          { label: experiment?.name ?? 'Experiment' },
        ]"
        icon="M4 5h16v11H9l-5 4z"
        :title="experiment?.name ?? t('adminExperimentPage.experiment')"
      />

      <p v-if="loaded && !experiment" class="adm-empty">
        {{ t("adminExperimentPage.this_experiment_doesn_t_exist_or") }}
        <router-link :to="{ name: 'admin' }">{{ t("adminExperimentPage.back_to_organizations") }}</router-link>
      </p>

      <template v-else-if="experiment">
        <div class="summary adm-card">
          <div class="summary-item">
            <span class="summary-label">{{ t("adminExperimentPage.service_name") }}</span>
            <span class="mono">{{ experiment.serviceName }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">{{ t("adminExperimentPage.your_role") }}</span>
            <Pill :tone="roleTone(experiment.myRole)">{{ ROLE_LABEL[experiment.myRole] }}</Pill>
          </div>
          <Button class="push" size="sm" :to="{ name: 'conversations', params: { experimentId: experiment.id } }">{{ t("adminExperimentPage.open_traces") }}</Button>
        </div>

        <TabBar v-model="tab" :tabs="tabs" />

        <section v-if="tab === 'connect'" class="panel">
          <p class="adm-sub">{{ t("adminExperimentPage.three_steps_to_start_sending_traces") }}</p>
          <ol class="adm-steps">
            <li class="adm-step">
              <span class="adm-step-num">1</span>
              <div class="adm-step-body">
                <h4 class="adm-step-title">{{ t("adminExperimentPage.create_an_api_key") }}</h4>
                <p class="adm-hint">
                  {{ keyCount ? `This experiment has ${keyCount} active key(s).` : "The agent needs a key to prove which experiment its traces belong to." }}
                </p>
                <Button variant="primary" size="sm" @click="tab = 'keys'">{{ keyCount ? t("adminExperimentPage.manage_api_keys") : t("adminExperimentPage.create_api_key") }}</Button>
                <p v-if="!canKeys && !keyCount" class="adm-hint">{{ t("adminExperimentPage.only_technical_profiles_and_organization") }}</p>
              </div>
            </li>
            <li class="adm-step">
              <span class="adm-step-num">2</span>
              <div class="adm-step-body">
                <h4 class="adm-step-title">{{ t("adminExperimentPage.set_these_variables_in_your_agent") }}</h4>
                <p class="adm-hint">{{ t("adminExperimentPage.replace") + " " }}<span class="adm-code">&lt;your-api-key&gt;</span>{{ " " + t("adminExperimentPage.with_the_key_from_step_1") }}</p>
                <div class="adm-snippet">
                  <pre>{{ envTemplate }}</pre>
                  <Button @click="copyTemplate">{{ t("adminExperimentPage.copy") }}</Button>
                </div>
              </div>
            </li>
            <li class="adm-step">
              <span class="adm-step-num">3</span>
              <div class="adm-step-body">
                <h4 class="adm-step-title">{{ t("adminExperimentPage.run_your_agent") }}</h4>
                <p class="adm-hint">{{ t("adminExperimentPage.its_traces_appear_in_this_experiment") }}</p>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="tab === 'keys'" class="panel">
          <p class="adm-sub">{{ t("adminExperimentPage.credentials_that_let_an_agent_write") }}</p>
          <ExperimentApiKeys :experiment="experiment" :can-manage="canKeys" />
        </section>

        <section v-if="tab === 'score-configs'" class="panel">
          <p class="adm-sub">
            {{ t("adminExperimentPage.a_score_config_is_a_rubric") }}
          </p>
          <ScoreConfigsPanel :experiment-id="experiment.id" :can-manage="canScoreConfigs" />
        </section>

        <section v-if="tab === 'approvals' && canApprovals" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">{{ t("adminExperimentPage.approvals_for_this_agent_s_prompts") }}</h3>
            <p class="adm-hint">{{ t("adminExperimentPage.extra_review_for_the_prompts_of") }}</p>
            <ApprovalRulesPanel :scope="{ type: 'experiment', id: experiment.id }" />
          </div>
        </section>

        <section v-if="tab === 'export' && canExport" class="panel">
          <ExperimentExport :experiment="experiment" />
        </section>

        <section v-if="tab === 'members' && canManage" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">{{ t("adminExperimentPage.who_can_access_this_experiment") }}</h3>
            <p class="adm-hint">{{ t("adminExperimentPage.technical_profiles_curate_the_reviews_an") }}</p>
            <MemberList :data="members" />
          </div>
          <InviteForm
            :title="t('adminExperimentPage.invite_someone_to_this_experiment')"
            help="If the person doesn't have an account yet, they'll receive an email to sign in with Google or Microsoft."
            :role-options="MEMBER_ROLE_OPTIONS"
            @invite="inviteMember"
          />
        </section>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  padding: 14px 18px;
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
.summary-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mt-muted);
}

/* cada pestaña es una superficie blanca sobre el fondo tintado; las tarjetas internas dejan de duplicar el blanco */
.panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 24px 28px;
  background: var(--mt-card);
  border-radius: var(--mt-radius-lg);
}
.panel > .adm-card {
  padding: 0;
}
.adm-step-body > :deep(button),
.adm-step-body > :deep(a) {
  align-self: flex-start;
}
.mono {
  font-family: var(--mt-mono);
  font-size: 13px;
}
.adm-section-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
  color: var(--mt-ink);
}
.adm-empty a {
  color: var(--mt-accent);
}
.push { margin-left: auto; }
</style>
