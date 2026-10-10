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
const ROLE_DESCRIPTION: Record<string, string> = {
  org_admin: "Invites people, creates experiments and manages API keys. Cannot read trace data.",
  technical: "Full technical work: span traces, curation, rubrics, datasets and their own API key.",
  business: "Read-only dashboard (conversations, metrics, costs, evaluations) and annotates in queues where they are a reviewer.",
};
const roleDescription = computed(() => ROLE_DESCRIPTION[form.role] ?? "");

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const groupHint = computed(() => {
  const value = form.externalGroup.trim();
  if (!value) return "";
  if (GUID.test(value)) return "Looks like an Entra ID Object ID.";
  if (/\s/.test(value)) return "Contains spaces. Entra ID sends an Object ID (a code like 3f2a9c1e-…), not the group name. Okta and others send the name.";
  return "Make sure it is exactly what the token carries: Entra ID sends the Object ID, not the group name.";
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
        Use the groups you already have in your identity provider (Entra ID, Okta, SailPoint…). You do not create groups here: you only say which role each group gets in MemTrace.
      </p>
      <ol class="steps adm-hint" data-testid="identity-steps">
        <li>In your identity provider, find the group and copy its ID.</li>
        <li>Here, paste it, choose where it applies and which role it gives.</li>
        <li>People get the role the next time they sign in. If they leave the group, they lose it. Roles you assign by hand are never touched.</li>
      </ol>

      <h4 class="sub">Current mappings</h4>
      <ul v-if="identity.mappings.length" class="adm-list" data-testid="mappings">
        <li v-for="m in identity.mappings" :key="m.id" class="adm-item">
          <div class="adm-item-main">
            <span class="adm-item-title mono">{{ m.externalGroup }}</span>
            <span class="adm-item-meta">{{ experimentName(m.experimentId) }}</span>
          </div>
          <Pill :tone="roleTone(m.role)">{{ ROLE_LABEL[m.role] }}</Pill>
          <Button variant="danger" size="sm" data-testid="remove-mapping" @click="removeMapping(m.id)">Remove</Button>
        </li>
      </ul>
      <p v-else class="adm-hint" data-testid="no-mappings">No mappings yet: access is only what you assign by hand.</p>

      <h4 class="sub">Add a mapping</h4>
      <form class="form" @submit.prevent="addMapping">
        <div class="field">
          <label class="label" for="mapping-group">1. Group ID</label>
          <TextInput mono id="mapping-group" v-model="form.externalGroup" placeholder="e.g. 3f2a9c1e-7b4d-4e0a-9c55-1d2e8f6a0b13" aria-label="Group" data-testid="mapping-group" />
          <p v-if="groupHint" class="adm-hint" data-testid="group-hint">{{ groupHint }}</p>
          <details class="where">
            <summary>Where do I find it?</summary>
            <ul>
              <li><strong>Microsoft Entra ID:</strong> Entra admin center → Entra ID → Groups → open the group → Overview → copy <span class="mono">Object ID</span>.</li>
              <li><strong>Okta:</strong> Directory → Groups. Use the group name exactly as the token carries it.</li>
              <li><strong>Not sure?</strong> It must match exactly the value that appears in the sign-in token's groups claim (see Advanced below).</li>
            </ul>
          </details>
        </div>

        <div class="field">
          <label class="label" for="mapping-target">2. Where does it apply?</label>
          <Select v-model="form.target" :options="targetOptions" aria-label="Applies to" data-testid="mapping-target" @update:model-value="onTargetChange" />
          <p class="adm-hint">An experiment, or the whole organization (for organization roles).</p>
        </div>

        <div class="field">
          <label class="label" for="mapping-role">3. Which role does it give?</label>
          <Select v-model="form.role" :options="roleSelectOptions" aria-label="Role" data-testid="mapping-role" />
          <p v-if="roleDescription" class="adm-hint" data-testid="role-description">{{ roleDescription }}</p>
        </div>

        <p v-if="previewGroup" class="preview" data-testid="mapping-preview">
          Everyone in <span class="mono">{{ previewGroup }}</span> will get <strong>{{ ROLE_LABEL[form.role] }}</strong> in <strong>{{ previewTarget }}</strong>.
        </p>
        <div><Button variant="primary" type="submit" :disabled="adding || !form.externalGroup.trim()" data-testid="add-mapping">Add mapping</Button></div>
      </form>

      <details class="where advanced">
        <summary>Advanced: where the token carries the groups</summary>
        <div class="row">
          <label class="adm-hint" for="claim">Claim name</label>
          <TextInput mono class="claim" id="claim" v-model="claimValue" data-testid="groups-claim" />
          <Button size="sm" :disabled="!claimTouched" @click="saveClaim">Save</Button>
        </div>
        <p class="adm-hint">
          Leave <span class="mono">groups</span> for Entra ID and Okta. Use <span class="mono">roles</span> if you use Entra app roles. If a sign-in token carries no groups at all, nobody's access changes.
        </p>
      </details>
    </section>

    <section class="adm-card">
      <h3 class="adm-section-title">Automatic provisioning (SCIM) <span class="optional">Optional</span></h3>
      <p class="adm-hint">
        Without SCIM, role changes apply the next time each person signs in. With SCIM, your provider (Entra ID, Okta, SailPoint) tells MemTrace at once when someone joins, leaves a group or is deactivated.
      </p>
      <ol class="steps adm-hint">
        <li>Create a token below and copy it (it is shown only once).</li>
        <li>In your provider, create a provisioning connection and paste the Base URL and the token.</li>
        <li>The SCIM <span class="mono">userName</span> must be the email people sign in with. Assign only the groups you mapped above.</li>
      </ol>
      <p v-if="scimUnreachable" class="adm-hint warn" data-testid="scim-warning">
        Your identity provider cannot reach this address: it is local or not HTTPS. Use a public HTTPS URL for MemTrace before configuring SCIM.
      </p>
      <div class="row">
        <span class="adm-hint">Base URL</span>
        <code class="mono" data-testid="scim-url">{{ identity.scimBaseUrl }}</code>
        <Button size="sm" @click="copy(identity.scimBaseUrl)">Copy</Button>
      </div>

      <div v-if="newToken" class="adm-card fresh" data-testid="new-token">
        <p class="adm-hint">Copy this token now: it is shown only once.</p>
        <div class="row"><code class="mono">{{ newToken }}</code><Button size="sm" @click="copy(newToken)">Copy</Button></div>
      </div>

      <ul v-if="identity.scimTokens.length" class="adm-list" data-testid="tokens">
        <li v-for="t in identity.scimTokens" :key="t.id" class="adm-item">
          <div class="adm-item-main">
            <span class="adm-item-title mono">{{ t.tokenPrefix }}…</span>
            <span class="adm-item-meta">created {{ formatDate(t.createdAt) }} · last used {{ formatDate(t.lastUsedAt) }}</span>
          </div>
          <Button variant="danger" size="sm" data-testid="revoke-token" @click="revokeToken(t.id)">Revoke</Button>
        </li>
      </ul>
      <div><Button variant="primary" data-testid="create-token" @click="createToken">Create SCIM token</Button></div>
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
