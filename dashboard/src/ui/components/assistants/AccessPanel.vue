<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { DeploymentSummaryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { formatRelativeTime } from "../../i18n/format";
import { personLabel } from "@/domain/assistants";
import EmptyState from "../EmptyState.vue";
import ErrorBanner from "../ErrorBanner.vue";
import AddAccessModal from "./AddAccessModal.vue";
import PersonAvatar from "./PersonAvatar.vue";
import Button from "../Button.vue";
import DataTable from "../DataTable.vue";
import Card from "../Card.vue";
import Pill from "../Pill.vue";
import { t } from "../../i18n";
import { lazyMessages } from "../../../domain/translate";

/** Quién puede llamar a un entorno (ADR-053). Documentado y sincronizado desde el proveedor de identidad; MemTrace no lo hace cumplir. */
const props = defineProps<{ experimentId: string; deployment: DeploymentSummaryDto; canGovern: boolean; nowMs: number }>();
const emit = defineEmits<{ changed: [] }>();

const api = useAssistantApi();
const $q = useQuasar();
const grants = useAsync((signal) => api.listGrants(props.experimentId, props.deployment.id, signal));
onMounted(() => void grants.run());
watch(() => props.deployment.id, () => void grants.run());

const adding = ref(false);
const TYPE_LABEL = lazyMessages({ user: "accessPanel.user", group: "accessPanel.group", everyone: "accessPanel.everyone" });
const SOURCE_LABEL = lazyMessages({ manual: "accessPanel.added_manually", oidc: "accessPanel.synced_at_sign_in", scim: "accessPanel.synced_by_scim" });

async function remove(grantId: string) {
  try {
    await api.removeGrant(props.experimentId, props.deployment.id, grantId);
    await grants.run();
    emit("changed");
  } catch (error) {
    $q.notify({ message: t("accessPanel.could_not_remove_access_error", { error: describeApiError(error as Error) }), color: "negative", timeout: 4000 });
  }
}
function saved() {
  void grants.run();
  emit("changed");
}
</script>

<template>
  <Card as="section" padding="none" block class="panel" data-testid="access-panel">
    <header class="head">
      <div class="title">
        <h2>{{ t("accessPanel.who_can_call_it_in") + " " }}<span class="mono">{{ deployment.environment.label }}</span></h2>
        <p>{{ t("accessPanel.documented_here_and_synced_from_the") }}</p>
      </div>
      <Button variant="primary" v-if="canGovern" @click="adding = true">{{ t("accessPanel.add_access") }}</Button>
    </header>
    <ErrorBanner v-if="grants.error.value" :error="grants.error.value" @retry="grants.run()" />
    <EmptyState v-else-if="(grants.data.value ?? []).length === 0 && !grants.loading.value" icon="lock_open" :title="t('accessPanel.no_access_defined')">
      Nobody is listed yet for {{ deployment.environment.label }}.
    </EmptyState>
    <DataTable v-else class="grid" bare>
      <thead><tr><th>{{ t("accessPanel.who") }}</th><th>{{ t("accessPanel.type") }}</th><th>{{ t("accessPanel.people") }}</th><th>{{ t("accessPanel.source") }}</th><th /></tr></thead>
      <tbody>
        <tr v-for="g in grants.data.value ?? []" :key="g.id">
          <td class="who">
            <span v-if="g.user" class="person-cell"><PersonAvatar :name="g.user.name" :email="g.user.email" :image="g.user.image" :size="22" />{{ personLabel(g.user) }}</span>
            <template v-else>{{ g.subjectType === "everyone" ? t("accessPanel.everyone_in_the_organization") : g.externalGroup ?? g.userId }}</template>
          </td>
          <td><Pill :tone="g.subjectType === 'group' ? 'info' : g.subjectType === 'everyone' ? 'highlight' : 'neutral'">{{ TYPE_LABEL[g.subjectType] }}</Pill></td>
          <td class="mono">{{ g.memberCount ?? (g.subjectType === "user" ? 1 : "–") }}</td>
          <td class="muted">{{ SOURCE_LABEL[g.source] }}<template v-if="g.syncedAt"> · {{ formatRelativeTime(g.syncedAt, nowMs) }}</template></td>
          <td class="end"><Button variant="link" v-if="canGovern" @click="remove(g.id)">{{ t("accessPanel.remove") }}</Button></td>
        </tr>
      </tbody>
    </DataTable>
    <AddAccessModal v-if="adding" :experiment-id="experimentId" :deployment-id="deployment.id" :env-label="deployment.environment.label" @close="adding = false" @saved="saved" />
  </Card>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }
.head { display: flex; align-items: center; gap: 12px; }
.title { flex: 1; }
h2 { margin: 0; font-size: 14px; font-weight: 800; }
p { margin: 2px 0 0; font-size: 12px; color: var(--mt-muted); }
.mono { font-family: var(--mt-mono); font-weight: 500; }

.who { font-weight: 700; }
.person-cell { display: inline-flex; align-items: center; gap: 8px; }
.muted { color: var(--mt-muted); }
.end { text-align: right; }
.link { font: inherit; font-size: 12px; font-weight: 700; color: var(--mt-accent-text); background: none; border: none; cursor: pointer; }
.link:hover { text-decoration: underline; }

</style>
