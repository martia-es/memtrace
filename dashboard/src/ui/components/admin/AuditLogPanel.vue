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
import { t } from "../../i18n";

/**
 * Registro de auditoría de la organización (ADR-084): quién abrió el contenido de una traza o conversación, quién exportó datos y
 * quién cambió accesos o configuración. Solo identificadores, nunca el contenido. Solo con `audit:read`.
 */
const props = defineProps<{ organization: OrganizationDto; experiments: ExperimentDto[] }>();

const api = useIdentityApi();
const $q = useQuasar();

const ACTIONS: { value: string; label: string }[] = [
  { value: "", get label() { return t("auditLogPanel.everything"); } },
  { value: "trace.view", get label() { return t("auditLogPanel.opened_a_trace"); } },
  { value: "conversation.view", get label() { return t("auditLogPanel.opened_a_conversation"); } },
  { value: "data.export", get label() { return t("auditLogPanel.exported_data"); } },
  { value: "retention.update", get label() { return t("auditLogPanel.changed_retention"); } },
  { value: "retention.purge", get label() { return t("auditLogPanel.deleted_expired_traces"); } },
  { value: "member.add", get label() { return t("auditLogPanel.added_a_member"); } },
  { value: "apikey.create", get label() { return t("auditLogPanel.created_an_api_key"); } },
  { value: "apikey.revoke", get label() { return t("auditLogPanel.revoked_an_api_key"); } },
  { value: "alert.create", get label() { return t("auditLogPanel.created_an_alert"); } },
  { value: "alert.update", get label() { return t("auditLogPanel.changed_an_alert"); } },
  { value: "alert.delete", get label() { return t("auditLogPanel.deleted_an_alert"); } },
  { value: "budget.update", get label() { return t("auditLogPanel.set_the_cost_budget"); } },
  { value: "budget.delete", get label() { return t("auditLogPanel.removed_the_cost_budget"); } },
  { value: "model_match.update", get label() { return t("auditLogPanel.decided_an_arena_match_for_a"); } },
  { value: "approval_exemption.grant", get label() { return t("auditLogPanel.exempted_an_agent_from_an_approval"); } },
  { value: "approval_exemption.revoke", get label() { return t("auditLogPanel.brought_back_an_approval_rule_for"); } },
  { value: "risk.classify", get label() { return t("auditLogPanel.classified_the_risk_of_an_agent"); } },
  { value: "partnership.create", get label() { return t("auditLogPanel.added_a_partner"); } },
  { value: "partnership.revoke", get label() { return t("auditLogPanel.ended_a_partnership"); } },
  { value: "partner_grant.create", get label() { return t("auditLogPanel.granted_a_partner_access"); } },
  { value: "partner_grant.revoke", get label() { return t("auditLogPanel.removed_a_partner_access"); } },
  { value: "partner.access", get label() { return t("auditLogPanel.a_partner_entered_an_experiment"); } },
];
const LABEL = new Proxy({} as Record<string, string>, { get: (_target, key) => ACTIONS.find((a) => a.value === key)?.label });

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
    notifyErrorWith($q.notify, t("auditLogPanel.could_not_load_the_audit_log"), error);
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
      return t("auditLogPanel.kind_rows_rows", { kind: String(m.kind), rows: String(m.rows) });
    case "retention.update":
      return m.days === null ? t("auditLogPanel.back_to_the_organization_s_period") : t("auditLogPanel.days_days", { days: String(m.days) });
    case "retention.purge":
      return t("auditLogPanel.spans_spans_older_than_days_days", { spans: String(m.spans), days: String(m.days) });
    case "member.add":
      return `${m.role}${m.status === "pending" ? ` ${t("auditLogPanel.invited")}` : ""}`;
    case "apikey.create":
      return String(m.keyPrefix ?? "");
    case "alert.create":
    case "alert.update":
    case "alert.delete":
      return String(m.name ?? "");
    case "budget.update":
      return t("auditLogPanel.amount_month_warn_at_percent", { amount: String(m.monthlyUsd), percent: String(m.warnPercent) });
    case "model_match.update":
      return `${e.targetId ?? ""}: ${m.decision === "confirm" ? t("auditLogPanel.confirmed_name", { name: String(m.arenaName) }) : m.decision === "reject" ? t("auditLogPanel.rejected_the_candidates") : m.decision === "no_equivalent" ? t("auditLogPanel.not_listed_by_arena") : t("auditLogPanel.back_to_automatic")}`;
    default:
      return e.targetId ? `${e.targetType ?? ""} ${e.targetId}`.trim() : "";
  }
}
</script>

<template>
  <div class="adm-card audit">
    <h3 class="adm-section-title">{{ t("auditLogPanel.audit_log") }}</h3>
    <p class="adm-hint">
      {{ t("auditLogPanel.who_opened_the_content_of_a") }}
    </p>

    <div class="filters">
      <FormField :label="t('auditLogPanel.what')">
        <select v-model="action" :aria-label="t('auditLogPanel.filter_by_action')">
          <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
        </select>
      </FormField>
      <FormField :label="t('auditLogPanel.experiment')">
        <select v-model="experimentId" :aria-label="t('auditLogPanel.filter_by_experiment')">
          <option value="">{{ t("auditLogPanel.all") }}</option>
          <option v-for="e in experiments" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </FormField>
    </div>

    <p v-if="loaded && !items.length" class="adm-empty">{{ t("auditLogPanel.nothing_recorded_for_this_filter_yet") }}</p>
    <DataTable v-else-if="items.length">
      <thead>
        <tr>
          <th>{{ t("auditLogPanel.when") }}</th>
          <th>{{ t("auditLogPanel.who") }}</th>
          <th>{{ t("auditLogPanel.what") }}</th>
          <th>{{ t("auditLogPanel.experiment") }}</th>
          <th>{{ t("auditLogPanel.detail") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in items" :key="e.id">
          <td class="when">{{ formatDate(e.at) }}</td>
          <td>{{ e.actorLabel }}</td>
          <td>{{ LABEL[e.action] ?? e.action }}</td>
          <td>{{ e.experimentId ? (experimentName.get(e.experimentId) ?? t("auditLogPanel.deleted")) : "—" }}</td>
          <td class="detail">{{ detail(e) }}</td>
        </tr>
      </tbody>
    </DataTable>
    <Button v-if="nextCursor" :disabled="loading" @click="load(true)">{{ t("auditLogPanel.show_older_entries") }}</Button>
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
