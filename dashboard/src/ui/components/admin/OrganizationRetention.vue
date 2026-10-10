<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuasar } from "quasar";
import type { RetentionPolicyDto } from "@contract";
import type { OrganizationDto } from "@/application/identity-api";
import { useIdentityApi } from "../../composables/useIdentityApi";
import { notifyErrorWith } from "../../composables/useAdminDirectory";

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
    notifyErrorWith($q.notify, "Could not load retention", error);
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
    $q.notify({ message: "Retention updated", color: "positive", timeout: 2000 });
  } catch (error) {
    notifyErrorWith($q.notify, "Could not update retention", error);
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
    $q.notify({ message: days === null ? "Using the organization's retention" : "Retention updated", color: "positive", timeout: 2000 });
  } catch (error) {
    notifyErrorWith($q.notify, "Could not update retention", error);
  } finally {
    savingExperiment.value = null;
  }
}
</script>

<template>
  <div class="retention">
    <div class="adm-card block">
      <h3 class="adm-section-title">How long traces are kept</h3>
      <p class="adm-hint">
        Every night (03:30 UTC) MemTrace deletes the traces older than this. It applies to the spans and topics of every experiment in
        <strong>{{ organization.name }}</strong>. Scores, annotations and end-user feedback are not traces and are kept.
      </p>
      <p class="adm-hint">
        The dashboard shows the last 30 days at most. A longer period keeps older traces so you can <strong>export</strong> them (Admin › experiment › Export), not to browse them.
      </p>
      <div v-if="policy" class="line">
        <label class="field">
          <span class="lbl">Organization default</span>
          <span class="inp">
            <input v-model.number="orgDays" type="number" :min="policy.minDays" :max="policy.maxDays" step="1" aria-label="Organization retention in days" @keyup.enter="saveOrg" />
            <span class="unit">days</span>
          </span>
        </label>
        <button class="adm-btn primary" type="button" :disabled="!orgDirty || !orgValid || savingOrg" @click="saveOrg">Save</button>
        <span v-if="!orgValid" class="warn">Choose a whole number from {{ policy.minDays }} to {{ policy.maxDays }}.</span>
        <span v-else-if="willTrim" class="warn">
          {{ willTrim }} experiment{{ willTrim === 1 ? "" : "s" }} with a longer own period will use this one instead.
        </span>
      </div>
      <p v-else-if="loading" class="adm-hint">Loading…</p>
    </div>

    <div v-if="policy" class="adm-card block">
      <h3 class="adm-section-title">By experiment</h3>
      <p class="adm-hint">An experiment can keep its traces for less time than the organization, never for more. Leave it empty to use the organization's.</p>
      <p v-if="!policy.experiments.length" class="adm-empty">This organization has no experiments yet.</p>
      <table v-else class="rt">
        <thead>
          <tr>
            <th>Experiment</th>
            <th>Own period</th>
            <th>Kept for</th>
            <th aria-label="Actions"></th>
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
                  :aria-label="`Own retention of ${e.name} in days`"
                />
                <span class="unit">days</span>
              </span>
            </td>
            <td>
              <span class="eff" :class="{ short: e.overrideDays !== null }">{{ e.effectiveDays }} days</span>
            </td>
            <td class="act">
              <button
                class="adm-btn small"
                type="button"
                :disabled="!experimentDirty(e.experimentId, e.overrideDays) || !experimentValid(e.experimentId) || savingExperiment === e.experimentId"
                @click="saveExperiment(e.experimentId, drafts[e.experimentId] ?? null)"
              >
                Save
              </button>
              <button v-if="e.overrideDays !== null" class="adm-btn ghost small" type="button" :disabled="savingExperiment === e.experimentId" @click="saveExperiment(e.experimentId, null)">
                Use default
              </button>
              <span v-if="!experimentValid(e.experimentId)" class="warn">1 to {{ policy.defaultDays }}</span>
            </td>
          </tr>
        </tbody>
      </table>
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
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lbl {
  font-size: 12px;
  font-weight: 600;
  color: var(--mt-muted);
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
.rt {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.rt th {
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--mt-muted);
  padding: 6px 8px;
}
.rt td {
  padding: 8px;
  border-top: 1px solid var(--mt-border);
  vertical-align: middle;
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
