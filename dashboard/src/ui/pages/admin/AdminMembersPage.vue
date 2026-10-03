<script setup lang="ts">
import { computed, ref } from "vue";
import "@/styles/admin.css";
import { ROLE_LABEL, formatDate, initials, useAdminDirectory } from "../../composables/useAdminDirectory";
import PageHeader from "../../components/PageHeader.vue";

/** Vista transversal: todas las personas con acceso y sus invitaciones pendientes, en un único listado. */
const dir = useAdminDirectory();
void dir.load();

interface Row {
  id: string;
  name: string;
  email: string;
  scope: string;
  scopeType: "organization" | "experiment";
  role: string;
  pending: boolean;
  date: string | null;
}

const rows = computed<Row[]>(() => {
  const out: Row[] = [];
  for (const o of dir.organizations.value) {
    const data = dir.membersByOrg[o.id];
    if (!data) continue;
    for (const m of data.members) out.push({ id: `org-m-${o.id}-${m.userId}`, name: m.name ?? m.email, email: m.email, scope: o.name, scopeType: "organization", role: m.role, pending: false, date: null });
    for (const inv of data.pendingInvitations) out.push({ id: `org-p-${inv.id}`, name: inv.email, email: inv.email, scope: o.name, scopeType: "organization", role: inv.role, pending: true, date: inv.createdAt });
  }
  for (const e of dir.experiments.value) {
    const data = dir.membersByExperiment[e.id];
    if (!data) continue;
    for (const m of data.members) out.push({ id: `exp-m-${e.id}-${m.userId}`, name: m.name ?? m.email, email: m.email, scope: e.name, scopeType: "experiment", role: m.role, pending: false, date: null });
    for (const inv of data.pendingInvitations) out.push({ id: `exp-p-${inv.id}`, name: inv.email, email: inv.email, scope: e.name, scopeType: "experiment", role: inv.role, pending: true, date: inv.createdAt });
  }
  // activos primero; pendientes al final
  return out.sort((a, b) => (a.pending === b.pending ? a.name.localeCompare(b.name) : a.pending ? 1 : -1));
});

const filter = ref("");
const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.scope.toLowerCase().includes(q));
});
</script>

<template>
  <q-page>
    <div class="adm-page">
      <PageHeader :crumbs="[{ label: 'MemTrace' }, { label: 'Admin', to: { name: 'admin' } }, { label: 'Members' }]" icon="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" title="Members" />

      <div class="adm-toolbar">
        <p class="adm-sub">Everyone with access to an organization or experiment, and which invitations are still waiting.</p>
        <input v-model="filter" class="adm-input" type="search" placeholder="Search by name, email or organization / experiment" />
      </div>

      <div class="adm-card list-card">
        <p v-if="dir.loading.value" class="adm-hint pad">Loading…</p>
        <p v-else-if="!filtered.length" class="adm-hint pad">No results.</p>
        <ul v-else class="adm-list">
          <li v-for="r in filtered" :key="r.id" class="adm-item" :class="{ pending: r.pending }">
            <div class="adm-avatar" :class="{ pending: r.pending }">{{ r.pending ? "?" : initials(r.name) }}</div>
            <div class="adm-item-main">
              <span class="adm-item-title">{{ r.name }}</span>
              <span class="adm-item-meta">{{ r.email }}</span>
            </div>
            <span class="adm-pill">{{ r.scopeType === "organization" ? "Organization" : "Experiment" }}: {{ r.scope }}</span>
            <span class="adm-pill" :class="[r.role, { outline: r.pending }]">{{ ROLE_LABEL[r.role] }}</span>
            <span class="adm-pill" :class="r.pending ? 'pending' : 'active'">{{ r.pending ? `pending · ${formatDate(r.date)}` : "active" }}</span>
          </li>
        </ul>
      </div>
    </div>
  </q-page>
</template>

<style scoped>
.adm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.list-card {
  padding: 8px;
}
.pad {
  padding: 20px 16px;
}
</style>
