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
    notifyErrorWith($q.notify, "Could not load your clients", error);
  } finally {
    loaded.value = true;
  }
});

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
  $q.notify({ message: "Copied", timeout: 1200, position: "bottom" });
}
</script>

<template>
  <q-page>
    <div class="adm-page">
      <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Clients' }]" icon="M4 5h16v11H9l-5 4z" title="Clients" />

      <div class="adm-head">
        <div>
          <h2 class="adm-title">Clients that gave you access</h2>
          <p class="adm-sub">You only see what each client granted you, and they can take it back at any time. Your access is recorded in their audit log.</p>
        </div>
      </div>

      <EmptyState v-if="loaded && !clients.length" icon="apartment" title="No client has given you access yet">
        Ask the client's admin to add your organization as a partner (Admin › their organization › Partners) using the id below, and then give you access.
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
        <h3 class="adm-section-title">Your organization id</h3>
        <p class="adm-hint">Give it to a client so they can add you as a partner. It is not secret, and on its own it grants nothing.</p>
        <ul class="ids">
          <li v-for="o in myOrganizations" :key="o.id">
            <span>{{ o.name }}</span>
            <code>{{ o.id }}</code>
            <Button @click="copy(o.id)">Copy</Button>
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
