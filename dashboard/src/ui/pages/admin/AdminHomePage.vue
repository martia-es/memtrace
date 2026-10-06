<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, ref } from "vue";
import { useQuasar } from "quasar";
import "@/styles/admin.css";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { canManageOrg, initials, notifyErrorWith, useAdminDirectory } from "../../composables/useAdminDirectory";
import PageHeader from "../../components/PageHeader.vue";
import EmptyState from "../../components/EmptyState.vue";
import Modal from "../../components/Modal.vue";

/** Nivel 1 del área de admin: las organizaciones. Cada tarjeta lleva a su organización (nivel 2). */
const api = useIdentityApi();
const $q = useQuasar();
const dir = useAdminDirectory();
void dir.load();

const experimentCount = computed(() => {
  const counts = new Map<string, number>();
  for (const e of dir.experiments.value) counts.set(e.organizationId, (counts.get(e.organizationId) ?? 0) + 1);
  return counts;
});

function memberCount(organizationId: string): number {
  const data = dir.membersByOrg[organizationId];
  return data ? data.members.length + data.pendingInvitations.length : 0;
}

const showCreate = ref(false);
const newName = ref("");
const creating = ref(false);
async function createOrganization() {
  if (!newName.value.trim()) return;
  creating.value = true;
  try {
    await api.createOrganization(newName.value.trim());
    newName.value = "";
    showCreate.value = false;
    await dir.reload();
  } catch (error) {
    notifyErrorWith($q.notify, "Could not create organization", error);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <q-page>
    <div class="adm-page">
      <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Admin' }]" icon="M4 5h16v11H9l-5 4z" title="Admin" />

      <div class="adm-head">
        <div>
          <h2 class="adm-title">Organizations</h2>
          <p class="adm-sub">
            An organization groups its experiments. Each experiment is one agent's traces, with its own API keys, score configs and members.
          </p>
        </div>
        <div class="adm-form-row">
          <router-link class="adm-btn ghost" :to="{ name: 'admin-members' }">All members</router-link>
          <button class="adm-btn primary mt-new" type="button" @click="showCreate = true">+ New organization</button>
        </div>
      </div>

      <p v-if="dir.loadError.value" class="adm-hint">Could not load: {{ dir.loadError.value }}</p>

      <EmptyState v-else-if="!dir.loading.value && !dir.organizations.value.length" icon="apartment" title="You don't have access to any organization yet">
        Create an organization to get started. You'll become its first org_admin.
      </EmptyState>

      <ul v-else class="org-grid">
        <li v-for="o in dir.organizations.value" :key="o.id">
          <router-link class="org-card" :to="{ name: 'admin-organization', params: { organizationId: o.id } }">
            <div class="adm-avatar big">{{ initials(o.name) }}</div>
            <div class="org-main">
              <span class="org-name">{{ o.name }}</span>
              <span class="org-stats">
                {{ experimentCount.get(o.id) ?? 0 }} experiment(s)
                <template v-if="canManageOrg(o)"> · {{ memberCount(o.id) }} member(s)</template>
              </span>
            </div>
            <span v-if="canManageOrg(o)" class="adm-pill org_admin">org_admin</span>
            <span v-else class="adm-pill">via experiment</span>
            <span class="chevron" aria-hidden="true">›</span>
          </router-link>
        </li>
      </ul>
    </div>

    <Modal v-if="showCreate" title="New organization" @close="showCreate = false">
      <form class="adm-form" @submit.prevent="createOrganization">
        <p class="adm-hint">Creating it makes you its first org_admin, with access to all of its experiments.</p>
        <TextInput v-model="newName" placeholder="Organization name, e.g. Acme" autofocus />
        <button type="submit" class="adm-btn primary" :disabled="creating || !newName.trim()">Create organization</button>
      </form>
    </Modal>
  </q-page>
</template>

<style scoped>
.org-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.org-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
  color: inherit;
  text-decoration: none;
  transition: box-shadow 0.15s ease;
}
.org-card:hover {
  box-shadow: inset 3px 0 0 var(--mt-accent);
}
.org-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.org-name {
  font-size: 14px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-stats {
  font-size: 12px;
  color: var(--mt-muted);
}
.chevron {
  color: var(--mt-muted);
  font-size: 18px;
}
</style>
