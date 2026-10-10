<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import Select from "../Select.vue";
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ExperimentDto, OrganizationDto } from "@/application/identity-api";
import { useAsync } from "../../composables/useAsync";
import { formatDate, notifyErrorWith } from "../../composables/useAdminDirectory";
import { useIdentityApi } from "../../composables/useIdentityApi";
import ErrorBanner from "../ErrorBanner.vue";
import Button from "../Button.vue";
import Pill from "../Pill.vue";

/**
 * Consultoras con acceso a esta organización (ADR-091). El cliente decide quién de la consultora entra, con qué rol y en
 * qué experimentos, y puede retirarlo en cualquier momento; el efecto es inmediato. Solo org_admin del cliente.
 */
const props = defineProps<{ organization: OrganizationDto; experiments: ExperimentDto[] }>();

const api = useIdentityApi();
const $q = useQuasar();
const state = useAsync((signal) => api.listPartnerships(props.organization.id, signal));
void state.run();
const partnerships = computed(() => state.data.value ?? []);

const experimentName = (id: string | null) => (id === null ? "Whole organization" : (props.experiments.find((e) => e.id === id)?.name ?? "Unknown experiment"));
const targetOptions = computed(() => [{ label: "Whole organization", value: "" }, ...props.experiments.map((e) => ({ label: e.name, value: e.id }))]);

// Un grant de partner nunca incluye exportar los datos, sea cual sea el rol (ADR-091).
const ROLE_OPTIONS = [
  { label: "technical (works with traces, prompts, datasets)", value: "technical" },
  { label: "business (read-only dashboard, annotates)", value: "business" },
];

const partnerId = ref("");
const creating = ref(false);
async function createPartnership() {
  if (!partnerId.value.trim()) return;
  creating.value = true;
  try {
    await api.createPartnership(props.organization.id, partnerId.value.trim());
    partnerId.value = "";
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not add the partner", error);
  } finally {
    creating.value = false;
  }
}

async function revokePartnership(id: string, name: string) {
  if (!window.confirm(`End the relationship with ${name}? Everyone from ${name} loses access immediately.`)) return;
  try {
    await api.revokePartnership(props.organization.id, id);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not end the relationship", error);
  }
}

const form = reactive<Record<string, { email: string; role: string; target: string }>>({});
const formOf = (id: string) => (form[id] ??= { email: "", role: "technical", target: "" });
const granting = ref<string | null>(null);

async function grant(partnershipId: string) {
  const f = formOf(partnershipId);
  if (!f.email.trim()) return;
  granting.value = partnershipId;
  try {
    await api.grantPartnerAccess(props.organization.id, partnershipId, { email: f.email.trim(), role: f.role, experimentId: f.target || null });
    f.email = "";
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not give access", error);
  } finally {
    granting.value = null;
  }
}

async function revokeGrant(partnershipId: string, grantId: string) {
  try {
    await api.revokePartnerGrant(props.organization.id, partnershipId, grantId);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not remove the access", error);
  }
}
</script>

<template>
  <div class="adm-card partners">
    <h3 class="adm-section-title">Partners</h3>
    <p class="adm-hint">
      A partner is a consultancy that operates this organization for you. Being a partner gives it <strong>no access by itself</strong>: you choose each
      person, their role and the experiments they can open, and you can take it back at any time. Partners can work with your traces, but
      they <strong>cannot export your data</strong>. Everything they open is recorded in the audit log.
    </p>

    <ErrorBanner v-if="state.error.value" :error="state.error.value" />

    <form class="adm-form-row" @submit.prevent="createPartnership">
      <TextInput mono v-model="partnerId" placeholder="Organization id of the consultancy" aria-label="Organization id of the consultancy" />
      <Button variant="primary" type="submit" :disabled="creating || !partnerId.trim()">Add partner</Button>
    </form>
    <p class="adm-hint">The consultancy gives you its organization id (it is shown on its “Clients” page).</p>

    <p v-if="state.data.value && !partnerships.length" class="adm-empty">No partners yet.</p>

    <section v-for="p in partnerships" :key="p.id" class="partner" :data-testid="`partner-${p.id}`">
      <header class="partner-head">
        <div>
          <strong>{{ p.partnerOrganizationName }}</strong>
          <span class="adm-hint"> · since {{ formatDate(p.createdAt) }}</span>
        </div>
        <Button @click="revokePartnership(p.id, p.partnerOrganizationName)">End relationship</Button>
      </header>

      <p v-if="!p.grants.length" class="adm-empty">Nobody from this partner has access yet.</p>
      <ul v-else class="grants">
        <li v-for="g in p.grants" :key="g.id">
          <span class="who">{{ g.userName ?? g.userEmail }} <span v-if="g.userName" class="adm-hint">{{ g.userEmail }}</span></span>
          <Pill tone="neutral">{{ g.role }}</Pill>
          <span class="adm-hint">{{ experimentName(g.experimentId) }}</span>
          <Button @click="revokeGrant(p.id, g.id)">Remove</Button>
        </li>
      </ul>

      <form class="adm-form-row" @submit.prevent="grant(p.id)">
        <TextInput v-model="formOf(p.id).email" type="email" placeholder="Email of the person from the partner" aria-label="Email of the person from the partner" />
        <Select v-model="formOf(p.id).role" :options="ROLE_OPTIONS" />
        <Select v-model="formOf(p.id).target" :options="targetOptions" />
        <Button variant="primary" type="submit" :disabled="granting === p.id || !formOf(p.id).email.trim()">Give access</Button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.partners {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.partner {
  border: 1px solid var(--mt-border);
  border-radius: var(--mt-radius-sm);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.partner-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.grants {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.grants li {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.who {
  min-width: 220px;
}
</style>
