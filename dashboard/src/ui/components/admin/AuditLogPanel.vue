<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useQuasar } from "quasar";
import type { AuditEntryDto } from "@contract";
import type { ExperimentDto, OrganizationDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { formatDate, notifyErrorWith } from "../../composables/useAdminDirectory";
import Button from "../Button.vue";
import DataTable from "../DataTable.vue";
import FormField from "../FormField.vue";

/**
 * Registro de auditoría de la organización (ADR-084): quién abrió el contenido de una traza o conversación, quién exportó datos y
 * quién cambió accesos o configuración. Solo identificadores, nunca el contenido. Solo con `audit:read`.
 */
const props = defineProps<{ organization: OrganizationDto; experiments: ExperimentDto[] }>();

const api = useIdentityApi();
const $q = useQuasar();

const ACTIONS: { value: string; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "trace.view", label: "Opened a trace" },
  { value: "conversation.view", label: "Opened a conversation" },
  { value: "data.export", label: "Exported data" },
  { value: "retention.update", label: "Changed retention" },
  { value: "retention.purge", label: "Deleted expired traces" },
  { value: "member.add", label: "Added a member" },
  { value: "apikey.create", label: "Created an API key" },
  { value: "apikey.revoke", label: "Revoked an API key" },
];
const LABEL = Object.fromEntries(ACTIONS.filter((a) => a.value).map((a) => [a.value, a.label]));

const action = ref("");
const experimentId = ref("");
const items = ref<AuditEntryDto[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const loaded = ref(false);

const experimentName = computed(() => new Map(props.experiments.map((e) => [e.id, e.name])));

async function load(more = false) {
  loading.value = true;
  try {
    const page = await api.listAuditLog(props.organization.id, {
      action: action.value || undefined,
      experimentId: experimentId.value || undefined,
      cursor: more ? (nextCursor.value ?? undefined) : undefined,
      limit: 50,
    });
    items.value = more ? [...items.value, ...page.items] : page.items;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    notifyErrorWith($q.notify, "Could not load the audit log", error);
  } finally {
    loading.value = false;
    loaded.value = true;
  }
}
onMounted(() => load());
watch([action, experimentId], () => load());

/** Resumen corto de los datos de la entrada: lo que ayuda a entenderla, sin volcar el JSON. */
function detail(e: AuditEntryDto): string {
  const m = e.metadata as Record<string, unknown>;
  switch (e.action) {
    case "data.export":
      return `${m.kind}, ${m.rows} rows`;
    case "retention.update":
      return m.days === null ? "back to the organization's period" : `${m.days} days`;
    case "retention.purge":
      return `${m.spans} spans older than ${m.days} days`;
    case "member.add":
      return `${m.role}${m.status === "pending" ? " (invited)" : ""}`;
    case "apikey.create":
      return String(m.keyPrefix ?? "");
    default:
      return e.targetId ? `${e.targetType ?? ""} ${e.targetId}`.trim() : "";
  }
}
</script>

<template>
  <div class="adm-card audit">
    <h3 class="adm-section-title">Audit log</h3>
    <p class="adm-hint">
      Who opened the content of a trace or conversation, exported data, or changed access and settings. It records identifiers only, never the content itself.
      Entries are kept for one year.
    </p>

    <div class="filters">
      <FormField label="What">
        <select v-model="action" aria-label="Filter by action">
          <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
        </select>
      </FormField>
      <FormField label="Experiment">
        <select v-model="experimentId" aria-label="Filter by experiment">
          <option value="">All</option>
          <option v-for="e in experiments" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </FormField>
    </div>

    <p v-if="loaded && !items.length" class="adm-empty">Nothing recorded for this filter yet.</p>
    <DataTable v-else-if="items.length">
      <thead>
        <tr>
          <th>When</th>
          <th>Who</th>
          <th>What</th>
          <th>Experiment</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in items" :key="e.id">
          <td class="when">{{ formatDate(e.at) }}</td>
          <td>{{ e.actorLabel }}</td>
          <td>{{ LABEL[e.action] ?? e.action }}</td>
          <td>{{ e.experimentId ? (experimentName.get(e.experimentId) ?? "(deleted)") : "—" }}</td>
          <td class="detail">{{ detail(e) }}</td>
        </tr>
      </tbody>
    </DataTable>
    <Button v-if="nextCursor" :disabled="loading" @click="load(true)">Show older entries</Button>
  </div>
</template>

<style scoped>
.audit {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.filters {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
select {
  padding: 7px 9px;
  border: 1px solid var(--mt-border);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
}
.when {
  white-space: nowrap;
  color: var(--mt-muted);
}
.detail {
  font-family: var(--mt-mono);
  font-size: 12px;
  color: var(--mt-muted);
}
</style>
