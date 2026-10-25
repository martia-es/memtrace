<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { DeploymentSummaryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAsync } from "../../composables/useAsync";
import { useAssistantApi } from "../../composables/useAssistantApi";
import { formatRelativeTime } from "../../i18n/format";
import { initials as initialsOf, personLabel } from "@/domain/assistants";
import EmptyState from "../EmptyState.vue";
import ErrorBanner from "../ErrorBanner.vue";
import AddAccessModal from "./AddAccessModal.vue";
import PersonAvatar from "./PersonAvatar.vue";
import Button from "../Button.vue";
import Card from "../Card.vue";
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

const whoLabel = (g: { subjectType: string; externalGroup: string | null; userId: string | null }) => (g.subjectType === "everyone" ? t("accessPanel.everyone_in_the_organization") : g.externalGroup ?? g.userId ?? "–");

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
    <ul v-else class="people">
      <li v-for="g in grants.data.value ?? []" :key="g.id" class="person" :data-testid="`grant-${g.id}`">
        <PersonAvatar v-if="g.user" :name="g.user.name" :email="g.user.email" :image="g.user.image" :size="38" />
        <span v-else class="badge" :class="g.subjectType">{{ initialsOf(whoLabel(g)) }}</span>
        <div class="who">
          <b>{{ g.user ? personLabel(g.user) : whoLabel(g) }}</b>
          <span class="muted">{{ TYPE_LABEL[g.subjectType] }} · {{ g.memberCount ?? (g.subjectType === "user" ? 1 : "–") }} · {{ SOURCE_LABEL[g.source] }}<template v-if="g.syncedAt"> · {{ formatRelativeTime(g.syncedAt, nowMs) }}</template></span>
        </div>
        <Button variant="link" v-if="canGovern" class="remove" @click="remove(g.id)">{{ t("accessPanel.remove") }}</Button>
      </li>
    </ul>
    <AddAccessModal v-if="adding" :experiment-id="experimentId" :deployment-id="deployment.id" :env-label="deployment.environment.label" @close="adding = false" @saved="saved" />
  </Card>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; background: var(--mt-accent-tint); border-color: var(--mt-accent-soft); }
.head { display: flex; align-items: center; gap: 12px; }
.title { flex: 1; }
h2 { margin: 0; font-size: 14px; font-weight: 800; }
p { margin: 2px 0 0; font-size: 12px; color: var(--mt-muted); }
.mono { font-family: var(--mt-mono); font-weight: 500; }
.people { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.person { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius); min-width: 0; }
.badge { width: 38px; height: 38px; flex: none; display: grid; place-items: center; border-radius: 10px; font-size: 13px; font-weight: 800; background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.badge.everyone { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.who b { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { font-size: 12px; color: var(--mt-muted); }
</style>
