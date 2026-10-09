<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApprovalRulesResponse } from "@contract";
import type { ApprovalScope } from "@/application/prompt-api";
import { describeApiError } from "@/application/describe-api-error";
import { belowFloor, describeRule, profileLabel, ruleFor, stepLabel, steps } from "@/domain/approvals";
import { usePromptApi } from "../../composables/usePromptApi";
import ApprovalFlowChart, { type FlowStep } from "../ApprovalFlowChart.vue";

/**
 * Reglas de aprobación de prompts (ADR-076), de la organización o de un experimento: por cada paso (publicar una versión y
 * mover cada entorno) cuántas personas de qué perfil tienen que aprobar y quién tiene que aprobar sí o sí. Un experimento
 * parte del suelo de la organización y solo puede endurecerlo; la API lo exige, aquí además se avisa antes de guardar.
 */
const props = defineProps<{ scope: ApprovalScope }>();

const api = usePromptApi();
const $q = useQuasar();

const data = ref<ApprovalRulesResponse | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
const saving = ref(false);

async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    data.value = await api.getApprovalRules(props.scope);
  } catch (error) {
    loadError.value = describeApiError(error as Error);
  } finally {
    loading.value = false;
  }
}
void load();

const isExperiment = computed(() => props.scope.type === "experiment");
const rows = computed(() => steps(data.value?.options.environments ?? []));
const names = computed(() => Object.fromEntries((data.value?.options.candidates ?? []).map((c) => [c.userId, c.name?.trim() || c.email])));
const floorOf = (action: "publish" | "promote", stage: string) => ruleFor(data.value?.organizationRules ?? [], action, stage);
const allowedRoles = (action: "publish" | "promote") => (action === "publish" ? data.value?.options.publishRoles : data.value?.options.roles) ?? [];

// ---- organigrama: quién aprueba en cada paso ----
const flowSteps = computed<FlowStep[]>(() =>
  rows.value.map((row) => ({
    ...row,
    rule: ruleFor(data.value?.rules ?? [], row.action, row.stage),
    floor: isExperiment.value ? floorOf(row.action, row.stage) : null,
    open: editing.value?.action === row.action && editing.value.stage === row.stage,
  })),
);

// ---- editor de un paso ----
const editing = ref<{ action: "publish" | "promote"; stage: string } | null>(null);
const draft = reactive<{ mins: Record<string, number>; approvers: string[] }>({ mins: {}, approvers: [] });

function edit(row: { action: "publish" | "promote"; stage: string }) {
  const current = ruleFor(data.value?.rules ?? [], row.action, row.stage);
  const floor = floorOf(row.action, row.stage);
  draft.mins = {};
  for (const role of allowedRoles(row.action)) draft.mins[role] = 0;
  for (const source of [floor, current]) for (const r of source?.requirements ?? []) draft.mins[r.role] = Math.max(draft.mins[r.role] ?? 0, r.min);
  if (!current && !floor) draft.mins[allowedRoles(row.action)[0] ?? ""] = 1;
  draft.approvers = [...new Set([...(floor?.approvers ?? []), ...(current?.approvers ?? [])])];
  editing.value = { action: row.action, stage: row.stage };
}

const candidate = computed(() => ({
  requirements: Object.entries(draft.mins).filter(([, min]) => min > 0).map(([role, min]) => ({ role, min })),
  approvers: draft.approvers,
}));
const floorProblem = computed(() => (editing.value && isExperiment.value ? belowFloor(candidate.value, floorOf(editing.value.action, editing.value.stage)) : null));
const canSave = computed(() => !saving.value && !floorProblem.value && (candidate.value.requirements.length > 0 || candidate.value.approvers.length > 0));

function setMin(role: string, value: string) {
  const n = Math.trunc(Number(value));
  draft.mins[role] = Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 0;
}
function toggleRole(role: string, on: boolean) {
  draft.mins[role] = on ? Math.max(1, draft.mins[role] ?? 0) : 0;
}
function toggleApprover(userId: string, on: boolean) {
  draft.approvers = on ? [...draft.approvers, userId] : draft.approvers.filter((id) => id !== userId);
}

async function save() {
  if (!editing.value) return;
  saving.value = true;
  try {
    await api.setApprovalRule(props.scope, { ...editing.value, ...candidate.value });
    editing.value = null;
    await load();
    $q.notify({ message: "Approval rule saved", color: "positive", timeout: 2500 });
  } catch (error) {
    $q.notify({ message: `Could not save the rule: ${describeApiError(error as Error)}`, color: "negative", timeout: 5000 });
  } finally {
    saving.value = false;
  }
}

async function remove(row: { action: "publish" | "promote"; stage: string }) {
  saving.value = true;
  try {
    await api.deleteApprovalRule(props.scope, row.action, row.stage);
    if (editing.value?.action === row.action && editing.value.stage === row.stage) editing.value = null;
    await load();
    $q.notify({ message: isExperiment.value ? "Rule removed; the organization's rule still applies" : "Rule removed: no approval needed here", color: "positive", timeout: 3000 });
  } catch (error) {
    $q.notify({ message: `Could not remove the rule: ${describeApiError(error as Error)}`, color: "negative", timeout: 5000 });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="rules" data-testid="approval-rules">
    <p v-if="loading && !data" class="adm-hint">Loading the rules…</p>
    <p v-else-if="loadError" class="adm-empty" role="alert" data-testid="rules-error">{{ loadError }}</p>
    <template v-else-if="data">
      <p class="adm-hint">
        <template v-if="isExperiment">An experiment starts from the organization's rules and can only make them <b>stricter</b>: ask for more people or add a default approver, never fewer.</template>
        <template v-else>Choose, for each step, who has to approve before it happens. A step without a rule works as before. Experiments can add to these rules, never loosen them.</template>
      </p>

      <ApprovalFlowChart :steps="flowSteps" :names="names" test-prefix="rule">
        <template #actions="{ step }">
          <button class="adm-btn ghost small" type="button" :disabled="saving" data-testid="rule-edit" @click="edit(step)">{{ ruleFor(data.rules, step.action, step.stage) ? "Edit" : "Set up" }}</button>
          <button v-if="ruleFor(data.rules, step.action, step.stage)" class="adm-btn danger small" type="button" :disabled="saving" data-testid="rule-remove" @click="remove(step)">Remove</button>
        </template>
      </ApprovalFlowChart>

      <form v-if="editing" class="editor" data-testid="rule-editor" @submit.prevent="save">
        <h4>{{ stepLabel(editing.action, editing.stage) }}</h4>
        <fieldset>
          <legend>Who has to approve</legend>
          <p v-if="editing.action === 'publish'" class="adm-hint">Publishing a version is a review of the text, so only technical profiles can approve it.</p>
          <label v-for="role in allowedRoles(editing.action)" :key="role" class="role">
            <input type="checkbox" :checked="(draft.mins[role] ?? 0) > 0" :data-testid="`role-${role}`" @change="toggleRole(role, ($event.target as HTMLInputElement).checked)" />
            <span>{{ profileLabel(role) }}</span>
            <input
              type="number"
              min="1"
              max="10"
              class="min"
              :disabled="(draft.mins[role] ?? 0) === 0"
              :value="draft.mins[role] || ''"
              :aria-label="`Approvals needed from ${profileLabel(role)}`"
              :data-testid="`min-${role}`"
              @input="setMin(role, ($event.target as HTMLInputElement).value)"
            />
            <span class="adm-hint">approval(s)</span>
          </label>
        </fieldset>
        <fieldset>
          <legend>Default approvers <span class="adm-hint">(optional) — these people always have to approve</span></legend>
          <p v-if="data.options.candidates.length === 0" class="adm-hint">Nobody can approve yet: add members with a technical or business role to an experiment first.</p>
          <label v-for="c in data.options.candidates" :key="c.userId" class="role">
            <input type="checkbox" :checked="draft.approvers.includes(c.userId)" :data-testid="`approver-${c.userId}`" @change="toggleApprover(c.userId, ($event.target as HTMLInputElement).checked)" />
            <span>{{ c.name?.trim() || c.email }}</span>
            <span class="adm-hint">{{ c.roles.map(profileLabel).join(", ") }}</span>
          </label>
        </fieldset>
        <p v-if="floorProblem" class="problem" role="alert" data-testid="rule-floor-problem">{{ floorProblem }}</p>
        <div class="actions">
          <button class="adm-btn ghost small" type="button" @click="editing = null">Cancel</button>
          <button class="adm-btn primary small" type="submit" :disabled="!canSave" data-testid="rule-save">{{ saving ? "Saving…" : "Save rule" }}</button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.rules { display: flex; flex-direction: column; gap: 14px; }

.editor { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.editor h4 { margin: 0; font-size: 14px; }
fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
legend { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.role { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.min { width: 56px; height: 28px; padding: 0 6px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-xs); background: var(--mt-surface, transparent); color: var(--mt-ink); font: inherit; }
.problem { margin: 0; padding: 8px 10px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
