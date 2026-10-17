<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import "@/styles/admin.css";
import type { OrganizationDto } from "@/application/identity-api";
import type { PartnerClientDto } from "@contract";
import { useIdentityApi } from "../composables/useIdentityApi";
import { notifyErrorWith } from "../composables/useAdminDirectory";
import PageHeader from "../components/PageHeader.vue";
import EmptyState from "../components/EmptyState.vue";
import Button from "../components/Button.vue";
import Pill from "../components/Pill.vue";
import { t } from "../i18n";

/**
 * Home de la consultora (ADR-091): los clientes que le han dado acceso, con los experimentos y el rol concedidos. Solo
 * metadatos; los datos se abren por cada experimento, que exige el acceso. Aquí también ve el id de su organización, que
 * es lo que da a un cliente para que lo añada como partner.
 */
const api = useIdentityApi();
const $q = useQuasar();
const clients = ref<PartnerClientDto[]>([]);
const myOrganizations = ref<OrganizationDto[]>([]);
const loaded = ref(false);

onMounted(async () => {
  try {
    [clients.value, myOrganizations.value] = await Promise.all([api.listPartnerClients(), api.listOrganizations()]);
  } catch (error) {
    notifyErrorWith($q.notify, t("partnerClientsPage.could_not_load_your_clients"), error);
  } finally {
    loaded.value = true;
  }
});

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: t("partnerClientsPage.copied"), timeout: 1200, position: "bottom" });
}
</script>

<template>
  <q-page>
    <div class="adm-page">
      <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Clients' }]" icon="M4 5h16v11H9l-5 4z" :title="t('partnerClientsPage.clients')" />

      <div class="adm-head">
        <div>
          <h2 class="adm-title">{{ t("partnerClientsPage.clients_that_gave_you_access") }}</h2>
          <p class="adm-sub">{{ t("partnerClientsPage.you_only_see_what_each_client") }}</p>
        </div>
      </div>

      <EmptyState v-if="loaded && !clients.length" icon="apartment" :title="t('partnerClientsPage.no_client_has_given_you_access')">
        {{ t("partnerClientsPage.ask_the_client_s_admin_to") }}
      </EmptyState>

      <ul v-else class="clients">
        <li v-for="c in clients" :key="c.partnershipId" class="adm-card" :data-testid="`client-${c.organizationId}`">
          <h3 class="adm-section-title">{{ c.organizationName }}</h3>
          <ul class="experiments">
            <li v-for="e in c.experiments" :key="e.id">
              <router-link :to="{ name: 'overview', params: { experimentId: e.id } }">{{ e.name }}</router-link>
              <Pill tone="neutral">{{ e.role }}</Pill>
            </li>
          </ul>
        </li>
      </ul>

      <div v-if="myOrganizations.length" class="adm-card">
        <h3 class="adm-section-title">{{ t("partnerClientsPage.your_organization_id") }}</h3>
        <p class="adm-hint">{{ t("partnerClientsPage.give_it_to_a_client_so") }}</p>
        <ul class="ids">
          <li v-for="o in myOrganizations" :key="o.id">
            <span>{{ o.name }}</span>
            <code>{{ o.id }}</code>
            <Button @click="copy(o.id)">{{ t("partnerClientsPage.copy") }}</Button>
          </li>
        </ul>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.clients,
.experiments,
.ids {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.experiments li,
.ids li {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
code {
  font-family: var(--mt-mono);
  font-size: 12px;
}
</style>
