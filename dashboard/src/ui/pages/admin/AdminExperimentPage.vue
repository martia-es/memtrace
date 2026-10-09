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
import Button from "../../components/Button.vue";
import Pill from "../../components/Pill.vue";

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
    { id: "connect", label: "Connect" },
    { id: "keys", label: "API keys", count: keyCount.value ?? undefined },
    { id: "score-configs", label: "Score configs" },
  ];
  if (canApprovals.value) list.push({ id: "approvals", label: "Approvals" });
  if (canManage.value) {
    list.push({ id: "members", label: "Members", count: (members.value?.members.length ?? 0) + (members.value?.pendingInvitations.length ?? 0) });
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
  $q.notify({ message: "Copied", timeout: 1200, position: "bottom" });
}

async function inviteMember({ email, role }: { email: string; role: string }) {
  try {
    await api.addExperimentMember(props.experimentId, email, role);
    $q.notify({ message: "Invitation sent", color: "positive", timeout: 2500 });
    await dir.reload();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not invite", error);
  }
}

const MEMBER_ROLE_OPTIONS = [
  { label: "technical: curates reviews, rubrics, datasets and the technical trace", value: "technical" },
  { label: "business: sees the dashboard and labels in the queues they review", value: "business" },
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
        :title="experiment?.name ?? 'Experiment'"
      />

      <p v-if="loaded && !experiment" class="adm-empty">
        This experiment doesn't exist or you don't have access to it.
        <router-link :to="{ name: 'admin' }">Back to organizations</router-link>
      </p>

      <template v-else-if="experiment">
        <div class="summary adm-card">
          <div class="summary-item">
            <span class="summary-label">service.name</span>
            <span class="mono">{{ experiment.serviceName }}</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Your role</span>
            <Pill :tone="roleTone(experiment.myRole)">{{ ROLE_LABEL[experiment.myRole] }}</Pill>
          </div>
          <Button class="push" size="sm" :to="{ name: 'conversations', params: { experimentId: experiment.id } }">Open traces</Button>
        </div>

        <TabBar v-model="tab" :tabs="tabs" />

        <section v-if="tab === 'connect'" class="panel">
          <p class="adm-sub">Three steps to start sending traces from your agent.</p>
          <ol class="adm-steps">
            <li class="adm-step">
              <span class="adm-step-num">1</span>
              <div class="adm-step-body">
                <h4 class="adm-step-title">Create an API key</h4>
                <p class="adm-hint">
                  {{ keyCount ? `This experiment has ${keyCount} active key(s).` : "The agent needs a key to prove which experiment its traces belong to." }}
                </p>
                <Button variant="primary" size="sm" @click="tab = 'keys'">{{ keyCount ? "Manage API keys" : "Create API key" }}</Button>
                <p v-if="!canKeys && !keyCount" class="adm-hint">Only technical profiles and organization admins can create keys.</p>
              </div>
            </li>
            <li class="adm-step">
              <span class="adm-step-num">2</span>
              <div class="adm-step-body">
                <h4 class="adm-step-title">Set these variables in your agent</h4>
                <p class="adm-hint">Replace <span class="adm-code">&lt;your-api-key&gt;</span> with the key from step 1.</p>
                <div class="adm-snippet">
                  <pre>{{ envTemplate }}</pre>
                  <Button @click="copyTemplate">Copy</Button>
                </div>
              </div>
            </li>
            <li class="adm-step">
              <span class="adm-step-num">3</span>
              <div class="adm-step-body">
                <h4 class="adm-step-title">Run your agent</h4>
                <p class="adm-hint">Its traces appear in this experiment's conversations within a few seconds.</p>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="tab === 'keys'" class="panel">
          <p class="adm-sub">Credentials that let an agent write traces into this experiment.</p>
          <ExperimentApiKeys :experiment="experiment" :can-manage="canKeys" />
        </section>

        <section v-if="tab === 'score-configs'" class="panel">
          <p class="adm-sub">
            A score config is a rubric: it defines what can be scored on a trace (a number range, yes/no, or categories), so labels
            from different people are comparable. Annotation queues use them.
          </p>
          <ScoreConfigsPanel :experiment-id="experiment.id" :can-manage="canScoreConfigs" />
        </section>

        <section v-if="tab === 'approvals' && canApprovals" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">Approvals for this agent's prompts</h3>
            <p class="adm-hint">Extra review for the prompts of this agent, on top of what the organization already asks. You can add people or approvers; you cannot ask for fewer than the organization.</p>
            <ApprovalRulesPanel :scope="{ type: 'experiment', id: experiment.id }" />
          </div>
        </section>

        <section v-if="tab === 'members' && canManage" class="panel">
          <div class="adm-card">
            <h3 class="adm-section-title">Who can access this experiment</h3>
            <p class="adm-hint">Technical profiles curate the reviews and manage rubrics, datasets and their own keys. Business profiles see the dashboard and label in the queues they review.</p>
            <MemberList :data="members" />
          </div>
          <InviteForm
            title="Invite someone to this experiment"
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

.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
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
