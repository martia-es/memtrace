<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ExperimentDto, OrganizationDto } from "@/application/identity-api";
import { useAsync } from "../../composables/useAsync";
import { formatDate, notifyErrorWith, ROLE_LABEL, roleTone } from "../../composables/useAdminDirectory";
import { useIdentityApi } from "../../composables/useIdentityApi";
import ErrorBanner from "../ErrorBanner.vue";
import Button from "../Button.vue";
import Pill from "../Pill.vue";
import { t } from "../../i18n";
import { tr, lazyMessages } from "../../../domain/translate";

/**
 * Identidad externa de la organización (ADR-052): qué grupo de tu proveedor (Entra ID, Okta, SailPoint…) da qué rol, y
 * el acceso SCIM para que ese proveedor dé de alta y de baja sin esperar al login. Solo org_admin.
 */
const props = defineProps<{ organization: OrganizationDto; experiments: ExperimentDto[] }>();

const api = useIdentityApi();
const $q = useQuasar();
const state = useAsync((signal) => api.getOrganizationIdentity(props.organization.id, signal));
void state.run();

const identity = computed(() => state.data.value);
const experimentName = (id: string | null) => (id === null ? t("organizationIdentity.whole_organization") : (props.experiments.find((e) => e.id === id)?.name ?? t("organizationIdentity.unknown_experiment")));

// Los roles que se pueden dar: de organización si el destino es toda la organización, de experimento si es uno concreto.
const ORG_ROLES = ["org_admin"];
const EXPERIMENT_ROLES = ["technical", "business"];

const form = reactive({ externalGroup: "", target: "" as string, role: ORG_ROLES[0]! });
const roleOptions = computed(() => (form.target === "" ? ORG_ROLES : EXPERIMENT_ROLES));
function onTargetChange() {
  form.role = roleOptions.value[0]!;
}
const adding = ref(false);

async function addMapping() {
  if (!form.externalGroup.trim()) return;
  adding.value = true;
  try {
    await api.createExternalMapping(props.organization.id, { externalGroup: form.externalGroup.trim(), experimentId: form.target || null, role: form.role });
    form.externalGroup = "";
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationIdentity.could_not_add_the_mapping"), error);
  } finally {
    adding.value = false;
  }
}

async function removeMapping(id: string) {
  try {
    await api.deleteExternalMapping(props.organization.id, id);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationIdentity.could_not_remove_the_mapping"), error);
  }
}

const claim = ref("");
const claimTouched = ref(false);
const claimValue = computed({
  get: () => (claimTouched.value ? claim.value : (identity.value?.groupsClaim ?? "groups")),
  set: (v: string) => {
    claim.value = v;
    claimTouched.value = true;
  },
});
async function saveClaim() {
  if (!claimValue.value.trim()) return;
  try {
    await api.setGroupsClaim(props.organization.id, claimValue.value.trim());
    claimTouched.value = false;
    await state.run();
    $q.notify({ message: t("organizationIdentity.saved"), color: "positive", timeout: 1800 });
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationIdentity.could_not_save_the_claim"), error);
  }
}

const newToken = ref<string | null>(null);
async function createToken() {
  try {
    newToken.value = (await api.createScimToken(props.organization.id)).plaintext;
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationIdentity.could_not_create_the_token"), error);
  }
}
async function revokeToken(id: string) {
  try {
    await api.revokeScimToken(props.organization.id, id);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationIdentity.could_not_revoke_the_token"), error);
  }
}
function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: t("organizationIdentity.copied"), timeout: 1200, position: "bottom" });
}
const ROLE_DESCRIPTION: Record<string, string> = lazyMessages({
  org_admin: "organizationIdentity.invites_people_creates_experiments_and_m",
  technical: "organizationIdentity.full_technical_work_span_traces_curation",
  business: "organizationIdentity.read_only_dashboard_conversations_metric",
});
const roleDescription = computed(() => ROLE_DESCRIPTION[form.role] ?? "");

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const groupHint = computed(() => {
  const value = form.externalGroup.trim();
  if (!value) return "";
  if (GUID.test(value)) return t("organizationIdentity.looks_like_an_entra_id_object");
  if (/\s/.test(value)) return t("organizationIdentity.contains_spaces_entra_id_sends_an");
  return t("organizationIdentity.make_sure_it_is_exactly_what");
});

const previewGroup = computed(() => form.externalGroup.trim());
const previewTarget = computed(() => experimentName(form.target || null));

// SCIM solo funciona si el proveedor llega a la URL: necesita una dirección pública con HTTPS.
const scimUnreachable = computed(() => {
  const raw = identity.value?.scimBaseUrl;
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "0.0.0.0" || url.hostname.startsWith("127.") || !url.hostname.includes(".");
    return local || url.protocol !== "https:";
  } catch {
    return false;
  }
});

const targetOptions = computed(() => [{ label: t("organizationIdentity.whole_organization"), value: "" }, ...props.experiments.map((e) => ({ label: e.name, value: e.id }))]);
const roleSelectOptions = computed(() => roleOptions.value.map((r) => ({ label: ROLE_LABEL[r] ?? r, value: r })));
</script>

<template>
  <ErrorBanner v-if="state.error.value" :error="state.error.value" @retry="state.run()" />
  <div v-else-if="!identity" class="adm-hint">{{ t("organizationIdentity.loading") }}</div>
  <div v-else class="identity" data-testid="organization-identity">
    <section class="adm-card">
      <h3 class="adm-section-title">{{ t("organizationIdentity.group_mappings") }}</h3>
      <p class="adm-hint">
        {{ t("organizationIdentity.use_the_groups_you_already_have") }}
      </p>
      <ol class="steps adm-hint" data-testid="identity-steps">
        <li>{{ t("organizationIdentity.in_your_identity_provider_find_the") }}</li>
        <li>{{ t("organizationIdentity.here_paste_it_choose_where_it") }}</li>
        <li>{{ t("organizationIdentity.people_get_the_role_the_next") }}</li>
      </ol>

      <h4 class="sub">{{ t("organizationIdentity.current_mappings") }}</h4>
      <ul v-if="identity.mappings.length" class="adm-list" data-testid="mappings">
        <li v-for="m in identity.mappings" :key="m.id" class="adm-item">
          <div class="adm-item-main">
            <span class="adm-item-title mono">{{ m.externalGroup }}</span>
            <span class="adm-item-meta">{{ experimentName(m.experimentId) }}</span>
          </div>
          <Pill :tone="roleTone(m.role)">{{ ROLE_LABEL[m.role] }}</Pill>
          <Button variant="danger" size="sm" data-testid="remove-mapping" @click="removeMapping(m.id)">{{ t("organizationIdentity.remove") }}</Button>
        </li>
      </ul>
      <p v-else class="adm-hint" data-testid="no-mappings">{{ t("organizationIdentity.no_mappings_yet_access_is_only") }}</p>

      <h4 class="sub">{{ t("organizationIdentity.add_a_mapping") }}</h4>
      <form class="form" @submit.prevent="addMapping">
        <div class="field">
          <label class="label" for="mapping-group">{{ t("organizationIdentity.1_group_id") }}</label>
          <TextInput mono id="mapping-group" v-model="form.externalGroup" placeholder="e.g. 3f2a9c1e-7b4d-4e0a-9c55-1d2e8f6a0b13" :aria-label="t('organizationIdentity.group')" data-testid="mapping-group" />
          <p v-if="groupHint" class="adm-hint" data-testid="group-hint">{{ groupHint }}</p>
          <details class="where">
            <summary>{{ t("organizationIdentity.where_do_i_find_it") }}</summary>
            <ul>
              <li><strong>{{ t("organizationIdentity.microsoft_entra_id") }}</strong>{{ " " + t("organizationIdentity.entra_admin_center_entra_id_groups") + " " }}<span class="mono">{{ t("organizationIdentity.object_id") }}</span>.</li>
              <li><strong>{{ t("organizationIdentity.okta") }}</strong>{{ " " + t("organizationIdentity.directory_groups_use_the_group_name") }}</li>
              <li><strong>{{ t("organizationIdentity.not_sure") }}</strong>{{ " " + t("organizationIdentity.it_must_match_exactly_the_value") }}</li>
            </ul>
          </details>
        </div>

        <div class="field">
          <label class="label" for="mapping-target">{{ t("organizationIdentity.2_where_does_it_apply") }}</label>
          <Select v-model="form.target" :options="targetOptions" :aria-label="t('organizationIdentity.applies_to')" data-testid="mapping-target" @update:model-value="onTargetChange" />
          <p class="adm-hint">{{ t("organizationIdentity.an_experiment_or_the_whole_organization") }}</p>
        </div>

        <div class="field">
          <label class="label" for="mapping-role">{{ t("organizationIdentity.3_which_role_does_it_give") }}</label>
          <Select v-model="form.role" :options="roleSelectOptions" :aria-label="t('organizationIdentity.role')" data-testid="mapping-role" />
          <p v-if="roleDescription" class="adm-hint" data-testid="role-description">{{ roleDescription }}</p>
        </div>

        <p v-if="previewGroup" class="preview" data-testid="mapping-preview">
          {{ t("organizationIdentity.everyone_in") + " " }}<span class="mono">{{ previewGroup }}</span>{{ " " + t("organizationIdentity.will_get") + " " }}<strong>{{ ROLE_LABEL[form.role] }}</strong>{{ " " + t("organizationIdentity.in") + " " }}<strong>{{ previewTarget }}</strong>.
        </p>
        <div><Button variant="primary" type="submit" :disabled="adding || !form.externalGroup.trim()" data-testid="add-mapping">{{ t("organizationIdentity.add_mapping") }}</Button></div>
      </form>

      <details class="where advanced">
        <summary>{{ t("organizationIdentity.advanced_where_the_token_carries_the") }}</summary>
        <div class="row">
          <label class="adm-hint" for="claim">{{ t("organizationIdentity.claim_name") }}</label>
          <TextInput mono class="claim" id="claim" v-model="claimValue" data-testid="groups-claim" />
          <Button size="sm" :disabled="!claimTouched" @click="saveClaim">{{ t("organizationIdentity.save") }}</Button>
        </div>
        <p class="adm-hint">
          {{ t("organizationIdentity.leave") + " " }}<span class="mono">groups</span>{{ " " + t("organizationIdentity.for_entra_id_and_okta_use") + " " }}<span class="mono">roles</span>{{ " " + t("organizationIdentity.if_you_use_entra_app_roles") }}
        </p>
      </details>
    </section>

    <section class="adm-card">
      <h3 class="adm-section-title">{{ t("organizationIdentity.automatic_provisioning_scim") + " " }}<span class="optional">{{ t("organizationIdentity.optional") }}</span></h3>
      <p class="adm-hint">
        {{ t("organizationIdentity.without_scim_role_changes_apply_the") }}
      </p>
      <ol class="steps adm-hint">
        <li>{{ t("organizationIdentity.create_a_token_below_and_copy") }}</li>
        <li>{{ t("organizationIdentity.in_your_provider_create_a_provisioning") }}</li>
        <li>{{ t("organizationIdentity.the_scim") + " " }}<span class="mono">userName</span>{{ " " + t("organizationIdentity.must_be_the_email_people_sign") }}</li>
      </ol>
      <p v-if="scimUnreachable" class="adm-hint warn" data-testid="scim-warning">
        {{ t("organizationIdentity.your_identity_provider_cannot_reach_this") }}
      </p>
      <div class="row">
        <span class="adm-hint">{{ t("organizationIdentity.base_url") }}</span>
        <code class="mono" data-testid="scim-url">{{ identity.scimBaseUrl }}</code>
        <Button size="sm" @click="copy(identity.scimBaseUrl)">{{ t("organizationIdentity.copy") }}</Button>
      </div>

      <div v-if="newToken" class="adm-card fresh" data-testid="new-token">
        <p class="adm-hint">{{ t("organizationIdentity.copy_this_token_now_it_is") }}</p>
        <div class="row"><code class="mono">{{ newToken }}</code><Button size="sm" @click="copy(newToken)">{{ t("organizationIdentity.copy") }}</Button></div>
      </div>

      <ul v-if="identity.scimTokens.length" class="adm-list" data-testid="tokens">
        <li v-for="tok in identity.scimTokens" :key="tok.id" class="adm-item">
          <div class="adm-item-main">
            <span class="adm-item-title mono">{{ tok.tokenPrefix }}…</span>
            <span class="adm-item-meta">{{ tr("organizationIdentity.created_created_last_used_used", { created: formatDate(tok.createdAt), used: formatDate(tok.lastUsedAt) }) }}</span>
          </div>
          <Button variant="danger" size="sm" data-testid="revoke-token" @click="revokeToken(tok.id)">{{ t("organizationIdentity.revoke") }}</Button>
        </li>
      </ul>
      <div><Button variant="primary" data-testid="create-token" @click="createToken">{{ t("organizationIdentity.create_scim_token") }}</Button></div>
    </section>
  </div>
</template>

<style scoped>
.identity {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.claim {
  max-width: 220px;
}
.fresh {
  border-color: var(--mt-accent);
}
.mono {
  font-family: var(--mt-mono);
}
.steps {
  margin: 10px 0 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sub {
  margin: 18px 0 6px;
  font-size: 13px;
  font-weight: 600;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 640px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.label {
  font-size: 13px;
  font-weight: 600;
}
.where {
  font-size: 13px;
  color: var(--mt-muted);
  margin-top: 4px;
}
.where summary {
  cursor: pointer;
  color: var(--mt-accent);
}
.where ul {
  margin: 6px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.advanced {
  margin-top: 18px;
}
.preview {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  font-size: 13px;
}
.optional {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}
.warn {
  margin-top: 8px;
  color: var(--mt-warn-ink);
}
code {
  word-break: break-all;
}
</style>
