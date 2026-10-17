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
import { t } from "../../i18n";

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

const experimentName = (id: string | null) => (id === null ? t("organizationPartners.whole_organization") : (props.experiments.find((e) => e.id === id)?.name ?? t("organizationPartners.unknown_experiment")));
const targetOptions = computed(() => [{ label: t("organizationPartners.whole_organization"), value: "" }, ...props.experiments.map((e) => ({ label: e.name, value: e.id }))]);

// Un grant de partner nunca incluye exportar los datos, sea cual sea el rol (ADR-091).
const ROLE_OPTIONS = [
  { get label() { return t("organizationPartners.technical_works_with_traces_prompts_data"); }, value: "technical" },
  { get label() { return t("organizationPartners.business_read_only_dashboard_annotates"); }, value: "business" },
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
    notifyErrorWith($q.notify, t("organizationPartners.could_not_add_the_partner"), error);
  } finally {
    creating.value = false;
  }
}

async function revokePartnership(id: string, name: string) {
  if (!window.confirm(t("organizationPartners.end_the_relationship_with_name_everyone", { name }))) return;
  try {
    await api.revokePartnership(props.organization.id, id);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationPartners.could_not_end_the_relationship"), error);
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
    notifyErrorWith($q.notify, t("organizationPartners.could_not_give_access"), error);
  } finally {
    granting.value = null;
  }
}

async function revokeGrant(partnershipId: string, grantId: string) {
  try {
    await api.revokePartnerGrant(props.organization.id, partnershipId, grantId);
    await state.run();
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationPartners.could_not_remove_the_access"), error);
  }
}
</script>

<template>
  <div class="adm-card partners">
    <h3 class="adm-section-title">{{ t("organizationPartners.partners") }}</h3>
    <p class="adm-hint">
      {{ t("organizationPartners.a_partner_is_a_consultancy_that") + " " }}<strong>{{ t("organizationPartners.no_access_by_itself") }}</strong>{{ t("organizationPartners.you_choose_each_person_their_role") + " " }}<strong>{{ t("organizationPartners.cannot_export_your_data") }}</strong>{{ t("organizationPartners.everything_they_open_is_recorded_in") }}
    </p>

    <ErrorBanner v-if="state.error.value" :error="state.error.value" />

    <form class="adm-form-row" @submit.prevent="createPartnership">
      <TextInput mono v-model="partnerId" :placeholder="t('organizationPartners.organization_id_of_the_consultancy')" :aria-label="t('organizationPartners.organization_id_of_the_consultancy')" />
      <Button variant="primary" type="submit" :disabled="creating || !partnerId.trim()">{{ t("organizationPartners.add_partner") }}</Button>
    </form>
    <p class="adm-hint">{{ t("organizationPartners.the_consultancy_gives_you_its_organizati") }}</p>

    <p v-if="state.data.value && !partnerships.length" class="adm-empty">{{ t("organizationPartners.no_partners_yet") }}</p>

    <section v-for="p in partnerships" :key="p.id" class="partner" :data-testid="`partner-${p.id}`">
      <header class="partner-head">
        <div>
          <strong>{{ p.partnerOrganizationName }}</strong>
          <span class="adm-hint"> · {{ t('organizationPartners.since_when', { when: formatDate(p.createdAt) }) }}</span>
        </div>
        <Button @click="revokePartnership(p.id, p.partnerOrganizationName)">{{ t("organizationPartners.end_relationship") }}</Button>
      </header>

      <p v-if="!p.grants.length" class="adm-empty">{{ t("organizationPartners.nobody_from_this_partner_has_access") }}</p>
      <ul v-else class="grants">
        <li v-for="g in p.grants" :key="g.id">
          <span class="who">{{ g.userName ?? g.userEmail }} <span v-if="g.userName" class="adm-hint">{{ g.userEmail }}</span></span>
          <Pill tone="neutral">{{ g.role }}</Pill>
          <span class="adm-hint">{{ experimentName(g.experimentId) }}</span>
          <Button @click="revokeGrant(p.id, g.id)">{{ t("organizationPartners.remove") }}</Button>
        </li>
      </ul>

      <form class="adm-form-row" @submit.prevent="grant(p.id)">
        <TextInput v-model="formOf(p.id).email" type="email" :placeholder="t('organizationPartners.email_of_the_person_from_the')" :aria-label="t('organizationPartners.email_of_the_person_from_the')" />
        <Select v-model="formOf(p.id).role" :options="ROLE_OPTIONS" />
        <Select v-model="formOf(p.id).target" :options="targetOptions" />
        <Button variant="primary" type="submit" :disabled="granting === p.id || !formOf(p.id).email.trim()">{{ t("organizationPartners.give_access") }}</Button>
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
