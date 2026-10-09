<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApprovalRulesResponse } from "@contract";
import type { ApprovalScope } from "@/application/prompt-api";
import { describeApiError } from "@/application/describe-api-error";
import { belowFloor, describeRule, profileLabel, ruleFor, stepLabel, steps } from "@/domain/approvals";
import { usePromptApi } from "../../composables/usePromptApi";

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

// ---- organigrama: quién aprueba en cada paso (lo heredado de la organización, aparte de lo propio) ----
type Row = { action: "publish" | "promote"; stage: string };
interface Person { key: string; label: string; kind: "role" | "approver"; inherited: boolean }

const hasRule = (row: Row) => !!ruleFor(data.value?.rules ?? [], row.action, row.stage) || (isExperiment.value && !!floorOf(row.action, row.stage));
const isEditing = (row: Row) => editing.value?.action === row.action && editing.value.stage === row.stage;

/** Los nodos de un paso: perfiles (cuántos de cada) y personas obligatorias; en un experimento, marcando lo que pone la organización. */
function peopleOf(row: Row): Person[] {
  const own = ruleFor(data.value?.rules ?? [], row.action, row.stage);
  const floor = isExperiment.value ? floorOf(row.action, row.stage) : null;
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const [rule, inherited] of [[floor, true], [own, false]] as const) {
    for (const r of rule?.requirements ?? []) {
      const key = `role:${r.role}`;
      if (inherited || !seen.has(key)) out.push({ key: key + inherited, label: `${r.min} × ${profileLabel(r.role)}`, kind: "role", inherited });
      if (inherited) seen.add(key);
    }
    for (const id of rule?.approvers ?? []) {
      const key = `approver:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: names.value[id] ?? "Someone", kind: "approver", inherited });
    }
  }
  return out;
}

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

      <div class="chart" role="group" aria-label="Who has to approve each step">
        <div class="root"><span class="root-node">A change to a prompt</span></div>
        <ul class="branches">
          <li v-for="row in rows" :key="row.action + row.stage" class="branch" :class="{ open: isEditing(row) }" :data-testid="`rule-${row.action}-${row.stage || 'publish'}`">
            <div class="step" :class="{ none: !hasRule(row) }">
              <span class="step-title">{{ row.label }}</span>
              <span class="step-summary" data-testid="rule-summary">{{ describeRule(ruleFor(data.rules, row.action, row.stage), names) }}</span>
              <span v-if="isExperiment && floorOf(row.action, row.stage)" class="step-floor" data-testid="rule-floor">Organization: {{ describeRule(floorOf(row.action, row.stage), names) }}</span>
              <span class="step-actions">
                <button class="adm-btn ghost small" type="button" :disabled="saving" data-testid="rule-edit" @click="edit(row)">{{ ruleFor(data.rules, row.action, row.stage) ? "Edit" : "Set up" }}</button>
                <button v-if="ruleFor(data.rules, row.action, row.stage)" class="adm-btn danger small" type="button" :disabled="saving" data-testid="rule-remove" @click="remove(row)">Remove</button>
              </span>
            </div>
            <ul v-if="hasRule(row)" class="people">
              <li v-for="p in peopleOf(row)" :key="p.key" class="person" :class="[p.kind, { inherited: p.inherited }]">
                <span class="who">{{ p.label }}</span>
                <span class="tag">{{ p.inherited ? "organization" : p.kind === "approver" ? "always" : "any of" }}</span>
              </li>
            </ul>
            <p v-else class="nobody">No approval</p>
          </li>
        </ul>
      </div>

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

/* organigrama: raíz arriba, una rama por paso y debajo las personas que tienen que aprobar */
.chart { display: flex; flex-direction: column; align-items: center; gap: 0; padding: 16px 8px 8px; overflow-x: auto; }
.root-node { display: inline-block; padding: 8px 16px; font-size: 13px; font-weight: 800; color: #fff; background: var(--mt-accent, var(--mt-ink)); border-radius: var(--mt-radius-sm); }
.root { position: relative; padding-bottom: 20px; }
.root::after { content: ""; position: absolute; left: 50%; bottom: 0; width: 2px; height: 20px; background: var(--mt-line); }
.branches { display: flex; justify-content: center; gap: 12px; margin: 0; padding: 0; list-style: none; min-width: min-content; }
.branch { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: 210px; padding-top: 20px; }
/* conectores: barra horizontal entre hermanos + gancho vertical hasta cada paso */
.branch::before { content: ""; position: absolute; top: 0; left: -6px; right: -6px; height: 2px; background: var(--mt-line); }
.branch:first-child::before { left: 50%; }
.branch:last-child::before { right: 50%; }
.branch:only-child::before { display: none; }
.branch::after { content: ""; position: absolute; top: 0; left: 50%; width: 2px; height: 20px; background: var(--mt-line); }
.step { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: var(--mt-surface, transparent); border: 1.5px solid var(--mt-accent, var(--mt-ink)); border-radius: var(--mt-radius-sm); }
.step.none { border-style: dashed; border-color: var(--mt-line); }
.branch.open .step { box-shadow: 0 0 0 3px var(--mt-soft); }
.step-title { font-size: 13px; font-weight: 800; color: var(--mt-ink); }
.step-summary { font-size: 12px; color: var(--mt-muted); }
.step-floor { font-size: 11.5px; color: var(--mt-muted); }
.step-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.people { position: relative; display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0 0 0 14px; list-style: none; }
.people::before { content: ""; position: absolute; left: 4px; top: -8px; bottom: 14px; width: 2px; background: var(--mt-line); }
.person { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; font-size: 12.5px; background: var(--mt-soft); border-radius: var(--mt-radius-xs); }
.person::before { content: ""; position: absolute; left: -10px; top: 50%; width: 10px; height: 2px; background: var(--mt-line); }
.person .who { font-weight: 700; color: var(--mt-ink); }
.person .tag { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--mt-muted); }
.person.approver .who::before { content: "★ "; color: var(--mt-accent, var(--mt-ink)); }
.person.inherited { background: transparent; border: 1px dashed var(--mt-line); }
.nobody { margin: 0; padding-left: 14px; font-size: 12px; color: var(--mt-muted); }

.editor { display: flex; flex-direction: column; gap: 12px; padding: 14px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.editor h4 { margin: 0; font-size: 14px; }
fieldset { border: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
legend { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
.role { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.min { width: 56px; height: 28px; padding: 0 6px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-xs); background: var(--mt-surface, transparent); color: var(--mt-ink); font: inherit; }
.problem { margin: 0; padding: 8px 10px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
