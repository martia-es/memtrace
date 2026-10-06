<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ExperimentDto, OrganizationDto } from "@/application/identity-api";
import { useAsync } from "../../composables/useAsync";
import { formatDate, notifyErrorWith, ROLE_LABEL } from "../../composables/useAdminDirectory";
import { useIdentityApi } from "../../composables/useIdentityApi";
import ErrorBanner from "../ErrorBanner.vue";

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
const experimentName = (id: string | null) => (id === null ? "Whole organization" : (props.experiments.find((e) => e.id === id)?.name ?? "Unknown experiment"));

// Los roles que se pueden dar: de organización si el destino es toda la organización, de experimento si es uno concreto.
const ORG_ROLES = ["org_admin"];
const EXPERIMENT_ROLES = ["technical", "business"];

const form = reactive({ externalGroup: "", target: "" as string, role: "technical" });
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
    notifyErrorWith($q.notify, "Could not add the mapping", error);
  } finally {
    adding.value = false;
  }
}

async function removeMapping(id: string) {
  try {
    await api.deleteExternalMapping(props.organization.id, id);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not remove the mapping", error);
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
    $q.notify({ message: "Saved", color: "positive", timeout: 1800 });
  } catch (error) {
    notifyErrorWith($q.notify, "Could not save the claim", error);
  }
}

const newToken = ref<string | null>(null);
async function createToken() {
  try {
    newToken.value = (await api.createScimToken(props.organization.id)).plaintext;
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not create the token", error);
  }
}
async function revokeToken(id: string) {
  try {
    await api.revokeScimToken(props.organization.id, id);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not revoke the token", error);
  }
}
function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: "Copied", timeout: 1200, position: "bottom" });
}
const targetOptions = computed(() => [{ label: "Whole organization", value: "" }, ...props.experiments.map((e) => ({ label: e.name, value: e.id }))]);
const roleSelectOptions = computed(() => roleOptions.value.map((r) => ({ label: ROLE_LABEL[r] ?? r, value: r })));
</script>

<template>
  <ErrorBanner v-if="state.error.value" :error="state.error.value" @retry="state.run()" />
  <div v-else-if="!identity" class="adm-hint">Loading…</div>
  <div v-else class="identity" data-testid="organization-identity">
    <section class="adm-card">
      <h3 class="adm-section-title">Group mappings</h3>
      <p class="adm-hint">
        Say which group of your identity provider gives which role. People get the role the next time they sign in (or at once if your provider syncs with SCIM below);
        losing the group removes it. Roles you assign by hand are never touched.
      </p>

      <ul v-if="identity.mappings.length" class="adm-list" data-testid="mappings">
        <li v-for="m in identity.mappings" :key="m.id" class="adm-item">
          <div class="adm-item-main">
            <span class="adm-item-title mono">{{ m.externalGroup }}</span>
            <span class="adm-item-meta">{{ experimentName(m.experimentId) }}</span>
          </div>
          <span class="adm-pill" :class="m.role">{{ ROLE_LABEL[m.role] }}</span>
          <button type="button" class="adm-btn danger small" data-testid="remove-mapping" @click="removeMapping(m.id)">Remove</button>
        </li>
      </ul>
      <p v-else class="adm-hint" data-testid="no-mappings">No mappings yet: access is only what you assign by hand.</p>

      <form class="row" @submit.prevent="addMapping">
        <TextInput mono v-model="form.externalGroup" placeholder="Group name or id, exactly as in the token" aria-label="Group" data-testid="mapping-group" />
        <Select v-model="form.target" :options="targetOptions" aria-label="Applies to" data-testid="mapping-target" @update:model-value="onTargetChange" />
        <Select v-model="form.role" :options="roleSelectOptions" aria-label="Role" data-testid="mapping-role" />
        <button type="submit" class="adm-btn primary" :disabled="adding || !form.externalGroup.trim()" data-testid="add-mapping">Add mapping</button>
      </form>

      <div class="row">
        <label class="adm-hint" for="claim">Claim that carries the groups in the sign-in token</label>
        <TextInput mono class="claim" id="claim" v-model="claimValue" data-testid="groups-claim" />
        <button type="button" class="adm-btn ghost small" :disabled="!claimTouched" @click="saveClaim">Save</button>
      </div>
      <p class="adm-hint">Usually <span class="mono">groups</span> (Entra ID, Okta) or <span class="mono">roles</span> (Entra app roles). If a token carries no groups at all, nobody's access changes.</p>
    </section>

    <section class="adm-card">
      <h3 class="adm-section-title">Automatic provisioning (SCIM)</h3>
      <p class="adm-hint">
        Point your provider (Entra ID, Okta, SailPoint) at the address below with a token. It then creates and deactivates people and pushes group membership;
        a deactivated person loses the roles they got from groups immediately. The SCIM <span class="mono">userName</span> must be the email they sign in with.
      </p>
      <div class="row">
        <span class="adm-hint">Base URL</span>
        <code class="mono" data-testid="scim-url">{{ identity.scimBaseUrl }}</code>
        <button type="button" class="adm-btn ghost small" @click="copy(identity.scimBaseUrl)">Copy</button>
      </div>

      <div v-if="newToken" class="adm-card fresh" data-testid="new-token">
        <p class="adm-hint">Copy this token now: it is shown only once.</p>
        <div class="row"><code class="mono">{{ newToken }}</code><button type="button" class="adm-btn ghost small" @click="copy(newToken)">Copy</button></div>
      </div>

      <ul v-if="identity.scimTokens.length" class="adm-list" data-testid="tokens">
        <li v-for="t in identity.scimTokens" :key="t.id" class="adm-item">
          <div class="adm-item-main">
            <span class="adm-item-title mono">{{ t.tokenPrefix }}…</span>
            <span class="adm-item-meta">created {{ formatDate(t.createdAt) }} · last used {{ formatDate(t.lastUsedAt) }}</span>
          </div>
          <button type="button" class="adm-btn danger small" data-testid="revoke-token" @click="revokeToken(t.id)">Revoke</button>
        </li>
      </ul>
      <div><button type="button" class="adm-btn primary" data-testid="create-token" @click="createToken">Create SCIM token</button></div>
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
code {
  word-break: break-all;
}
</style>
