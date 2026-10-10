<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useQuasar } from "quasar";
import type { ApprovalRulesResponse } from "@contract";
import type { ApprovalScope } from "@/application/prompt-api";
import { describeApiError } from "@/application/describe-api-error";
import { belowFloor, describeRule, profileLabel, ruleFor, stepLabel, steps } from "@/domain/approvals";
import { usePromptApi } from "../../composables/usePromptApi";
import ApprovalFlowChart, { type FlowStep } from "../ApprovalFlowChart.vue";
import Button from "../Button.vue";
import Checkbox from "../Checkbox.vue";

/**
 * Reglas de aprobación de prompts (ADR-076), de la organización o de un experimento: por cada paso (publicar una versión y
 * mover cada entorno) cuántas personas de qué perfil tienen que aprobar y quién tiene que aprobar sí o sí. Un experimento
 * parte del suelo de la organización y solo puede endurecerlo; la API lo exige, aquí además se avisa antes de guardar. La única
 * salida es una excepción por paso que concede un `org_admin` (la pestaña solo la ve quien tiene `approval:manage`): ese agente
 * deja de seguir la regla de la organización en ese paso y queda en la auditoría.
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
const isExempt = (action: "publish" | "promote", stage: string) => (data.value?.exemptions ?? []).some((x) => x.action === action && x.stage === stage);
/** El suelo que de verdad aplica a este agente: el de la organización, salvo que lo hayan eximido en ese paso. */
const floorOf = (action: "publish" | "promote", stage: string) => (isExempt(action, stage) ? null : orgRuleOf(action, stage));
const allowedRoles = (action: "publish" | "promote") => (action === "publish" ? data.value?.options.publishRoles : data.value?.options.roles) ?? [];

// ---- organigrama: quién aprueba en cada paso ----
const flowSteps = computed<FlowStep[]>(() =>
  rows.value.map((row) => ({
    ...row,
    rule: ruleFor(data.value?.rules ?? [], row.action, row.stage),
    floor: isExperiment.value ? floorOf(row.action, row.stage) : null,
    exempt: isExperiment.value && !!orgRuleOf(row.action, row.stage) && isExempt(row.action, row.stage),
    open: editing.value?.action === row.action && editing.value.stage === row.stage,
  })),
);

// ---- editor de un paso ----
const isEditing = (row: { action: string; stage: string }) => editing.value?.action === row.action && editing.value.stage === row.stage;
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

const floorProblem = computed(() => (editing.value && isExperiment.value ? belowFloor(candidate.value, floorOf(editing.value.action, editing.value.stage)) : null));
/** Una regla sin perfiles ni personas no se guarda: se explica por qué y cómo quitar la que haya. */
const emptyHint = computed(() => {
  if (!editing.value || candidate.value.requirements.length > 0 || candidate.value.approvers.length > 0) return null;
  const own = ruleFor(data.value?.rules ?? [], editing.value.action, editing.value.stage);
  if (own) return "A rule needs at least one profile or person. To stop asking for approval in this step, use Remove rule.";
  return isExperiment.value && isExempt(editing.value.action, editing.value.stage)
    ? "Nothing to save: this step already needs no approval. Add a profile or a person only if you want a rule of your own."
    : "A rule needs at least one profile or person. Without one there is nothing to save: press Cancel.";
});
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

async function toggleExemption(exempt: boolean) {
  if (!editing.value || props.scope.type !== "experiment") return;
  const { action, stage } = editing.value;
  saving.value = true;
  try {
    await api.setApprovalExemption(props.scope.id, action, stage, exempt);
    await load();
    $q.notify({ message: exempt ? "This agent no longer follows the organization's rule in this step" : "The organization's rule applies to this agent again", color: "positive", timeout: 3500 });
    if (editing.value) edit(editing.value);
  } catch (error) {
    $q.notify({ message: `Could not change the exemption: ${describeApiError(error as Error)}`, color: "negative", timeout: 5000 });
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
      <p class="intro">
        <template v-if="isExperiment">A change travels left to right. This agent starts from the organization's rules and can only make them <b>stricter</b>: ask for more people or add a default approver, never fewer. To follow a different rule in a step, exempt this agent from the organization's rule there.</template>
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
            <Button variant="danger" size="sm" v-if="ruleFor(data.rules, editing.action, editing.stage)" class="remove" :disabled="saving" data-testid="rule-remove" @click="remove(editing)">Remove rule</Button>
          </header>
          <label v-if="isExperiment && orgRuleOf(editing.action, editing.stage)" class="exempt" :class="{ on: isExempt(editing.action, editing.stage) }">
            <Checkbox :checked="isExempt(editing.action, editing.stage)" :disabled="saving" data-testid="rule-exempt-toggle" @change="toggleExemption(($event.target as HTMLInputElement).checked)" />
            <span class="grow">
              <b>Exempt this agent from the organization's rule</b>
              <span class="adm-hint">The organization asks for {{ describeRule(orgRuleOf(editing.action, editing.stage), names) }} here. Exempt, this agent follows only its own rule (or none). Other agents are not affected. It is recorded in the audit log.</span>
            </span>
          </label>
          <div class="cols">
            <fieldset>
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
            <fieldset>
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

.exempt { display: flex; align-items: flex-start; gap: 10px; padding: 12px 20px; border-bottom: 1px solid var(--mt-line); font-size: 13px; cursor: pointer; }
.exempt.on { background: var(--mt-soft); }
.exempt .grow { display: flex; flex-direction: column; gap: 2px; }
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
