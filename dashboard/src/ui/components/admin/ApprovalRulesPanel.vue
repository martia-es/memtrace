<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApprovalRulesResponse } from "@contract";
import type { ApprovalScope } from "@/application/prompt-api";
import { describeApiError } from "@/application/describe-api-error";
import { belowFloor, describeRule, profileLabel, ruleFor, sameRule, stepLabel, stepMode, steps, type StepMode } from "@/domain/approvals";
import { usePromptApi } from "../../composables/usePromptApi";
import ApprovalFlowChart, { type FlowStep } from "../ApprovalFlowChart.vue";
import Button from "../Button.vue";
import Checkbox from "../Checkbox.vue";
import Radio from "../Radio.vue";

/**
 * Reglas de aprobación de prompts (ADR-076), de la organización o de un experimento: por cada paso (publicar una versión y
 * mover cada entorno) cuántas personas de qué perfil tienen que aprobar y quién tiene que aprobar sí o sí. Un experimento
 * parte del suelo de la organización y solo puede endurecerlo; la API lo exige, aquí además se avisa antes de guardar. La única
 * salida es una excepción por paso que concede un `org_admin` (la pestaña solo la ve quien tiene `approval:manage`) y queda en la
 * auditoría. En un paso con regla de la organización la excepción y la regla propia se presentan como UNA elección de tres
 * (seguir la de la organización, usar solo la propia, no pedir aprobación) y un solo Save aplica lo que haga falta.
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
const orgRuleOf = (action: "publish" | "promote", stage: string) => ruleFor(data.value?.organizationRules ?? [], action, stage);
const ownRuleOf = (action: "publish" | "promote", stage: string) => ruleFor(data.value?.rules ?? [], action, stage);
const isExempt = (action: "publish" | "promote", stage: string) => (data.value?.exemptions ?? []).some((x) => x.action === action && x.stage === stage);
/** El suelo que de verdad aplica a este agente: el de la organización, salvo que lo hayan eximido en ese paso. */
const floorOf = (action: "publish" | "promote", stage: string) => (isExempt(action, stage) ? null : orgRuleOf(action, stage));
const allowedRoles = (action: "publish" | "promote") => (action === "publish" ? data.value?.options.publishRoles : data.value?.options.roles) ?? [];

/** El modo de un agente en un paso con regla de la organización; null si no hay tal regla (o es la organización). */
const modeOf = (action: "publish" | "promote", stage: string): StepMode | null =>
  isExperiment.value && orgRuleOf(action, stage) ? stepMode({ exempt: isExempt(action, stage), hasOwnRule: !!ownRuleOf(action, stage) }) : null;

// ---- organigrama: quién aprueba en cada paso ----
const flowSteps = computed<FlowStep[]>(() =>
  rows.value.map((row) => ({
    ...row,
    rule: ruleFor(data.value?.rules ?? [], row.action, row.stage),
    floor: isExperiment.value ? floorOf(row.action, row.stage) : null,
    mode: modeOf(row.action, row.stage) ?? undefined,
    open: editing.value?.action === row.action && editing.value.stage === row.stage,
  })),
);

// ---- editor de un paso ----
const isEditing = (row: { action: string; stage: string }) => editing.value?.action === row.action && editing.value.stage === row.stage;
const editing = ref<{ action: "publish" | "promote"; stage: string } | null>(null);
const draft = reactive<{ mins: Record<string, number>; approvers: string[] }>({ mins: {}, approvers: [] });

const mode = ref<StepMode | null>(null);

/** Rellena el borrador según el modo: seguir (suelo + lo propio), solo lo propio, o nada. */
function fill(row: { action: "publish" | "promote"; stage: string }, as: StepMode | null) {
  const current = ownRuleOf(row.action, row.stage);
  const floor = as === "own" || as === "none" ? null : orgRuleOf(row.action, row.stage);
  draft.mins = {};
  for (const role of allowedRoles(row.action)) draft.mins[role] = 0;
  if (as !== "none") for (const source of [floor, current]) for (const r of source?.requirements ?? []) draft.mins[r.role] = Math.max(draft.mins[r.role] ?? 0, r.min);
  if (as === null && !current && !floor) draft.mins[allowedRoles(row.action)[0] ?? ""] = 1;
  draft.approvers = as === "none" ? [] : [...new Set([...(floor?.approvers ?? []), ...(current?.approvers ?? [])])];
}

function edit(row: { action: "publish" | "promote"; stage: string }) {
  mode.value = modeOf(row.action, row.stage);
  fill(row, mode.value);
  editing.value = { action: row.action, stage: row.stage };
}

function setMode(next: unknown) {
  if (!editing.value || (next !== "follow" && next !== "own" && next !== "none")) return;
  mode.value = next;
  fill(editing.value, next);
}

const caretLeft = computed(() => {
  const at = rows.value.findIndex((r) => r.action === editing.value?.action && r.stage === editing.value.stage);
  return at < 0 ? "50%" : `${((at + 0.5) / rows.value.length) * 100}%`;
});

const candidate = computed(() => ({
  requirements: Object.entries(draft.mins).filter(([, min]) => min > 0).map(([role, min]) => ({ role, min })),
  approvers: draft.approvers,
}));
/** La regla que se está escribiendo, dicha en una frase. */
const preview = computed(() => {
  if (!editing.value) return "";
  const what = editing.value.action === "publish" ? "publish a version" : `move ${editing.value.stage}`;
  const parts = [
    ...candidate.value.requirements.map((r) => `${r.min} ${profileLabel(r.role).toLowerCase()} ${r.min > 1 ? "people" : "person"}`),
    ...candidate.value.approvers.map((id) => names.value[id] ?? "someone"),
  ];
  const total = candidate.value.requirements.reduce((n, r) => n + r.min, 0) + candidate.value.approvers.length;
  if (parts.length === 0) return `Nobody has to approve: anyone who can ${what} does it straight away.`;
  return `To ${what}, ${total} approval${total > 1 ? "s" : ""} ${total > 1 ? "are" : "is"} needed: ${parts.join(", ")}.`;
});
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** Solo al seguir la regla de la organización hay un suelo que no se puede bajar; usando la propia o sin aprobación ya no aplica. */
const floorProblem = computed(() => (editing.value && isExperiment.value && mode.value !== "own" && mode.value !== "none" ? belowFloor(candidate.value, orgRuleOf(editing.value.action, editing.value.stage)) : null));
const isEmpty = computed(() => candidate.value.requirements.length === 0 && candidate.value.approvers.length === 0);
/** Una regla sin perfiles ni personas no se guarda: se explica por qué y cómo quitar la que haya. */
const emptyHint = computed(() => {
  if (!editing.value || !isEmpty.value || mode.value === "none") return null;
  if (mode.value) return "Choose at least one profile or person, or pick \"No approval\" above.";
  if (ownRuleOf(editing.value.action, editing.value.stage)) return "A rule needs at least one profile or person. To stop asking for approval in this step, use Remove rule.";
  return "A rule needs at least one profile or person. Without one there is nothing to save: press Cancel.";
});
const canSave = computed(() => !saving.value && !floorProblem.value && (mode.value === "none" || !isEmpty.value));

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

const MODE_SAVED: Record<StepMode, string> = {
  follow: "This agent follows the organization's rule in this step",
  own: "This agent uses its own rule in this step",
  none: "This step needs no approval for this agent",
};

/**
 * Aplica lo que haga falta para el modo elegido, en el orden que la API exige: la exención va ANTES de la regla propia (si no, la
 * API la compararía con el suelo) y se quita ANTES de volver a seguir la regla de la organización.
 */
async function applyMode(chosen: StepMode, step: { action: "publish" | "promote"; stage: string }) {
  if (props.scope.type !== "experiment") return;
  const { id } = props.scope;
  const own = ownRuleOf(step.action, step.stage);
  const exempt = isExempt(step.action, step.stage);
  if (chosen === "follow") {
    if (exempt) await api.setApprovalExemption(id, step.action, step.stage, false);
    const floor = orgRuleOf(step.action, step.stage);
    if (floor && sameRule(candidate.value, floor)) {
      if (own) await api.deleteApprovalRule(props.scope, step.action, step.stage);
    } else await api.setApprovalRule(props.scope, { ...step, ...candidate.value });
    return;
  }
  if (!exempt) await api.setApprovalExemption(id, step.action, step.stage, true);
  if (chosen === "own") await api.setApprovalRule(props.scope, { ...step, ...candidate.value });
  else if (own) await api.deleteApprovalRule(props.scope, step.action, step.stage);
}

async function save() {
  if (!editing.value) return;
  saving.value = true;
  try {
    if (mode.value) await applyMode(mode.value, editing.value);
    else await api.setApprovalRule(props.scope, { ...editing.value, ...candidate.value });
    const saved = mode.value;
    editing.value = null;
    await load();
    $q.notify({ message: saved ? MODE_SAVED[saved] : "Approval rule saved", color: "positive", timeout: 3000 });
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
    $q.notify({ message: "Rule removed: no approval needed here", color: "positive", timeout: 3000 });
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
      <p class="intro">
        <template v-if="isExperiment">A change travels left to right. This agent starts from the organization's rules and can only make them <b>stricter</b>: ask for more people or add a default approver, never fewer. Where the organization has a rule, an org admin can choose for each step to follow it, use a rule of its own instead, or ask for no approval.</template>
        <template v-else>A change travels left to right. Each step can ask for a second opinion before it happens. A step without a rule works as before. Experiments can ask for more, never for less.</template>
      </p>
      <p class="legend">
        <span><i class="mark role">T</i>Any person with the profile</span>
        <span><i class="mark person">MF</i>This person, always</span>
      </p>

      <ApprovalFlowChart :steps="flowSteps" :names="names" test-prefix="rule">
        <template #actions="{ step }">
          <Button size="sm" :class="isEditing(step) ? 'primary' : 'ghost'" :disabled="saving" data-testid="rule-edit" @click="edit(step)">
            {{ isEditing(step) ? "Editing…" : ruleFor(data.rules, step.action, step.stage) ? "Edit rule" : "Set up" }}
          </Button>
        </template>
      </ApprovalFlowChart>

      <section v-if="editing" class="editor" data-testid="rule-editor" aria-label="Edit the rule">
        <span class="caret" :style="{ left: caretLeft }" aria-hidden="true" />
        <form @submit.prevent="save">
          <header>
            <span class="env">{{ editing.action === "publish" ? "PUBLISH" : editing.stage }}</span>
            <h4>Rule for {{ stepLabel(editing.action, editing.stage).toLowerCase() }}</h4>
            <Button variant="danger" size="sm" v-if="!mode && ruleFor(data.rules, editing.action, editing.stage)" class="remove" :disabled="saving" data-testid="rule-remove" @click="remove(editing)">Remove rule</Button>
          </header>
          <div v-if="mode" class="modes" role="radiogroup" aria-label="What this agent does in this step" data-testid="rule-modes">
            <span class="kicker">In this step, this agent…</span>
            <Radio class="opt" :class="{ on: mode === 'follow' }" name="step-mode" value="follow" :model-value="mode" data-testid="mode-follow" @update:model-value="setMode">
              <span class="txt"><b>Follow the organization's rule</b><span class="adm-hint">{{ describeRule(orgRuleOf(editing.action, editing.stage), names) }}. You can still add more people on top, never fewer.</span></span>
            </Radio>
            <Radio class="opt" :class="{ on: mode === 'own' }" name="step-mode" value="own" :model-value="mode" data-testid="mode-own" @update:model-value="setMode">
              <span class="txt"><b>Use its own rule instead</b><span class="adm-hint">Replaces the organization's rule in this step, only for this agent. Choose who approves.</span></span>
            </Radio>
            <Radio class="opt" :class="{ on: mode === 'none' }" name="step-mode" value="none" :model-value="mode" data-testid="mode-none" @update:model-value="setMode">
              <span class="txt"><b>No approval</b><span class="adm-hint">Whoever can do this does it straight away, only for this agent. It is recorded in the audit log.</span></span>
            </Radio>
          </div>
          <div class="cols" :class="{ single: mode === 'none' }">
            <fieldset v-if="mode !== 'none'">
              <legend>Profiles</legend>
              <p v-if="editing.action === 'publish'" class="adm-hint">Publishing a version is a review of the text, so only technical profiles can approve it.</p>
              <label v-for="role in allowedRoles(editing.action)" :key="role" class="row" :class="{ on: (draft.mins[role] ?? 0) > 0 }">
                <Checkbox :checked="(draft.mins[role] ?? 0) > 0" :data-testid="`role-${role}`" @change="toggleRole(role, ($event.target as HTMLInputElement).checked)" />
                <span class="grow">{{ profileLabel(role) }}</span>
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
              </label>
              <p class="adm-hint">A person counts for the profile they have.</p>
            </fieldset>
            <fieldset v-if="mode !== 'none'">
              <legend>People who must always approve <span>· optional</span></legend>
              <p v-if="data.options.candidates.length === 0" class="adm-hint">Nobody can approve yet: add members with a technical or business role to an experiment first.</p>
              <Checkbox v-for="c in data.options.candidates" :key="c.userId" class="row" :class="{ on: draft.approvers.includes(c.userId) }" :checked="draft.approvers.includes(c.userId)" :data-testid="`approver-${c.userId}`" @change="toggleApprover(c.userId, ($event.target as HTMLInputElement).checked)"> <span class="mark person">{{ initials(c.name?.trim() || c.email) }}</span>
                <span class="grow">{{ c.name?.trim() || c.email }}</span>
                <span class="adm-hint">{{ c.roles.map(profileLabel).join(", ") }}</span></Checkbox>
            </fieldset>
            <div class="means">
              <span class="kicker">What this means</span>
              <p data-testid="rule-preview">{{ preview }}</p>
              <p class="small">The person who asks never counts as an approver. A rejection closes the request. It expires after 7 days.</p>
              <p v-if="emptyHint" class="hint" role="note" data-testid="rule-empty-hint">{{ emptyHint }}</p>
              <p v-if="floorProblem" class="problem" role="alert" data-testid="rule-floor-problem">{{ floorProblem }}</p>
              <div class="actions">
                <Button size="sm" @click="editing = null">Cancel</Button>
                <Button variant="primary" size="sm" type="submit" :disabled="!canSave" data-testid="rule-save">{{ saving ? "Saving…" : "Save rule" }}</Button>
              </div>
            </div>
          </div>
        </form>
      </section>
    </template>
  </div>
</template>

<style scoped>
.rules { display: flex; flex-direction: column; gap: 14px; }
.intro { margin: 0; max-width: 760px; font-size: 14px; line-height: 1.55; color: var(--mt-muted); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0; font-size: 12px; font-weight: 600; color: var(--mt-muted); }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.mark { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex: none; border-radius: 4px; font-size: 10px; font-weight: 800; font-style: normal; background: var(--mt-accent-soft, var(--mt-line)); color: var(--mt-ink); }
.mark.person { border-radius: 50%; font-size: 8.5px; background: var(--mt-warn-bg, var(--mt-line)); }

.editor { position: relative; margin-top: 2px; }
.caret { position: absolute; top: -8px; width: 14px; height: 14px; margin-left: -7px; background: var(--mt-surface, var(--mt-bg)); border-top: 2px solid var(--mt-accent, var(--mt-ink)); border-left: 2px solid var(--mt-accent, var(--mt-ink)); transform: rotate(45deg); }
.editor form { border: 2px solid var(--mt-accent, var(--mt-ink)); border-radius: 10px; background: var(--mt-surface, transparent); overflow: hidden; }
header { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--mt-line); }
header h4 { flex: 1; margin: 0; font-size: 15px; font-weight: 800; }
.env { height: 22px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 4px; font: 800 11px/1 var(--mt-mono, monospace); background: var(--mt-accent, var(--mt-ink)); color: var(--mt-accent-ink, #fff); }

.modes { display: flex; flex-direction: column; gap: 8px; padding: 14px 20px; border-bottom: 1px solid var(--mt-line); }
.opt { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border: 1px solid var(--mt-line); border-radius: 8px; cursor: pointer; }
.opt.on { border: 2px solid var(--mt-accent, var(--mt-ink)); padding: 11px 13px; background: var(--mt-soft); }
.opt .txt { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.opt .adm-hint { font-weight: 400; }
.cols.single { grid-template-columns: minmax(0, 1fr); }
.cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 900px) { .cols { grid-template-columns: minmax(0, 1fr); } }
fieldset { border: none; margin: 0; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; border-right: 1px solid var(--mt-line); min-width: 0; }
legend { padding: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mt-muted); float: left; margin-bottom: 8px; width: 100%; }
legend span { font-weight: 500; letter-spacing: 0; text-transform: none; }
legend + * { clear: both; }
.row { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--mt-line); border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer; }
.row.on { border-color: var(--mt-accent, var(--mt-ink)); background: var(--mt-soft); }
.grow { flex: 1; min-width: 0; }
.min { width: 56px; height: 28px; padding: 0 6px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-xs); background: var(--mt-surface, transparent); color: var(--mt-ink); font: inherit; font-family: var(--mt-mono, monospace); font-weight: 800; text-align: center; }
.means { display: flex; flex-direction: column; gap: 10px; padding: 16px 20px; background: var(--mt-soft); }
.means p { margin: 0; font-size: 15px; line-height: 1.5; font-weight: 700; color: var(--mt-ink); }
.means p.small { font-size: 12px; font-weight: 500; color: var(--mt-muted); }
.kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mt-muted); }
.means p.hint { padding: 8px 10px; font-size: 13px; font-weight: 500; color: var(--mt-muted); background: var(--mt-bg, transparent); border: 1px dashed var(--mt-line); border-radius: var(--mt-radius-sm); }
.problem { padding: 8px 10px; font-size: 13px !important; color: var(--mt-err-ink) !important; background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; }
</style>
