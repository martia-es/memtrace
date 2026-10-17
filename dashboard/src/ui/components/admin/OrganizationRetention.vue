<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { RetentionPolicyDto } from "@contract";
import type { OrganizationDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { notifyErrorWith } from "../../composables/useAdminDirectory";
import Button from "../Button.vue";
import DataTable from "../DataTable.vue";
import FormField from "../FormField.vue";
import { t, tp } from "../../i18n";

/**
 * Cuánto tiempo se guardan las trazas (ADR-084): un plazo por organización y, si hace falta, uno más corto por experimento
 * (un agente con datos delicados). Cada noche se borra lo que lo supere. Solo con `retention:manage`.
 */
const props = defineProps<{ organization: OrganizationDto }>();

const api = useIdentityApi();
const $q = useQuasar();

const policy = ref<RetentionPolicyDto | null>(null);
const loading = ref(true);
const orgDays = ref<number | null>(null);
const savingOrg = ref(false);
// días escritos por experimento antes de guardar
const drafts = ref<Record<string, number | null>>({});
const savingExperiment = ref<string | null>(null);

function adopt(next: RetentionPolicyDto) {
  policy.value = next;
  orgDays.value = next.defaultDays;
  drafts.value = Object.fromEntries(next.experiments.map((e) => [e.experimentId, e.overrideDays]));
}

async function load() {
  loading.value = true;
  try {
    adopt(await api.getRetention(props.organization.id));
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationRetention.could_not_load_retention"), error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const orgValid = computed(() => !!policy.value && Number.isInteger(orgDays.value) && orgDays.value! >= policy.value.minDays && orgDays.value! <= policy.value.maxDays);
const orgDirty = computed(() => !!policy.value && orgDays.value !== policy.value.defaultDays);
// acortar la organización quita los plazos propios más largos: se avisa antes de guardar
const willTrim = computed(() => (orgValid.value && policy.value ? policy.value.experiments.filter((e) => e.overrideDays !== null && e.overrideDays > orgDays.value!).length : 0));

async function saveOrg() {
  if (!orgValid.value || orgDays.value === null) return;
  savingOrg.value = true;
  try {
    adopt(await api.setOrganizationRetention(props.organization.id, orgDays.value));
    $q.notify({ message: t("organizationRetention.retention_updated"), color: "positive", timeout: 2000 });
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationRetention.could_not_update_retention"), error);
  } finally {
    savingOrg.value = false;
  }
}

function experimentValid(id: string): boolean {
  const days = drafts.value[id];
  return days === null || days === undefined || (Number.isInteger(days) && days >= policy.value!.minDays && days <= policy.value!.defaultDays);
}
function experimentDirty(id: string, current: number | null): boolean {
  return (drafts.value[id] ?? null) !== current;
}

async function saveExperiment(id: string, days: number | null) {
  savingExperiment.value = id;
  try {
    adopt(await api.setExperimentRetention(props.organization.id, id, days));
    $q.notify({ message: days === null ? t("organizationRetention.using_the_organization_s_retention") : t("organizationRetention.retention_updated"), color: "positive", timeout: 2000 });
  } catch (error) {
    notifyErrorWith($q.notify, t("organizationRetention.could_not_update_retention"), error);
  } finally {
    savingExperiment.value = null;
  }
}
</script>

<template>
  <div class="retention">
    <div class="adm-card block">
      <h3 class="adm-section-title">{{ t("organizationRetention.how_long_traces_are_kept") }}</h3>
      <p class="adm-hint">
        {{ t("organizationRetention.every_night_03_30_utc_memtrace") }}
        <strong>{{ organization.name }}</strong>{{ t("organizationRetention.scores_annotations_and_end_user_feedback") }}
      </p>
      <p class="adm-hint">
        {{ t("organizationRetention.the_dashboard_can_show_up_to") + " " }}<strong>{{ t("organizationRetention.export") }}</strong>{{ " " + t("organizationRetention.it_admin_experiment_export") }}
      </p>
      <div v-if="policy" class="line">
        <FormField :label="t('organizationRetention.organization_default')">
          <span class="inp">
            <input v-model.number="orgDays" type="number" :min="policy.minDays" :max="policy.maxDays" step="1" :aria-label="t('organizationRetention.organization_retention_in_days')" @keyup.enter="saveOrg" />
            <span class="unit">{{ t("organizationRetention.days") }}</span>
          </span>
        </FormField>
        <Button variant="primary" :disabled="!orgDirty || !orgValid || savingOrg" @click="saveOrg">{{ t("organizationRetention.save") }}</Button>
        <span v-if="!orgValid" class="warn">{{ t("organizationRetention.choose_a_whole_number_from_min", { min: policy.minDays, max: policy.maxDays }) }}</span>
        <span v-else-if="willTrim" class="warn">
          {{ tp("organizationRetention.trim", willTrim) }}
        </span>
      </div>
      <p v-else-if="loading" class="adm-hint">{{ t("organizationRetention.loading") }}</p>
    </div>

    <div v-if="policy" class="adm-card block">
      <h3 class="adm-section-title">{{ t("organizationRetention.by_experiment") }}</h3>
      <p class="adm-hint">{{ t("organizationRetention.an_experiment_can_keep_its_traces") }}</p>
      <p v-if="!policy.experiments.length" class="adm-empty">{{ t("organizationRetention.this_organization_has_no_experiments_yet") }}</p>
      <DataTable v-else>
        <thead>
          <tr>
            <th>{{ t("organizationRetention.experiment") }}</th>
            <th>{{ t("organizationRetention.own_period") }}</th>
            <th>{{ t("organizationRetention.kept_for") }}</th>
            <th :aria-label="t('organizationRetention.actions')"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in policy.experiments" :key="e.experimentId">
            <td>
              <span class="name">{{ e.name }}</span>
              <span class="svc mono">{{ e.serviceName }}</span>
            </td>
            <td>
              <span class="inp">
                <input
                  v-model.number="drafts[e.experimentId]"
                  type="number"
                  :min="policy.minDays"
                  :max="policy.defaultDays"
                  step="1"
                  :placeholder="String(policy.defaultDays)"
                  :aria-label="t('organizationRetention.own_retention_of_name_in_days', { name: e.name })"
                />
                <span class="unit">{{ t("organizationRetention.days") }}</span>
              </span>
            </td>
            <td>
              <span class="eff" :class="{ short: e.overrideDays !== null }">{{ t("organizationRetention.count_days", { count: e.effectiveDays }) }}</span>
            </td>
            <td class="act">
              <Button
                size="sm"
                :disabled="!experimentDirty(e.experimentId, e.overrideDays) || !experimentValid(e.experimentId) || savingExperiment === e.experimentId"
                @click="saveExperiment(e.experimentId, drafts[e.experimentId] ?? null)"
              >
                {{ t("organizationRetention.save") }}
              </Button>
              <Button v-if="e.overrideDays !== null" size="sm" variant="link" :disabled="savingExperiment === e.experimentId" @click="saveExperiment(e.experimentId, null)">
                {{ t("organizationRetention.use_default") }}
              </Button>
              <span v-if="!experimentValid(e.experimentId)" class="warn">{{ t('organizationRetention.1_to_max', { max: policy.defaultDays }) }}</span>
            </td>
          </tr>
        </tbody>
      </DataTable>
    </div>
  </div>
</template>

<style scoped>
.retention {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.line {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.inp {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.inp input {
  width: 88px;
  padding: 7px 9px;
  border: 1px solid var(--mt-border);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
}
.unit {
  color: var(--mt-muted);
  font-size: 13px;
}
.warn {
  color: var(--mt-warn, #b45309);
  font-size: 12px;
}
.name {
  display: block;
  font-weight: 600;
}
.svc {
  color: var(--mt-muted);
  font-size: 12px;
}
.mono {
  font-family: var(--mt-mono);
}
.eff.short {
  color: var(--mt-accent);
  font-weight: 600;
}
.act {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
</style>
