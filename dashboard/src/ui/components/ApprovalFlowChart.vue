<script setup lang="ts">
import { computed } from "vue";
import type { ApprovalRuleDto } from "@contract";
import { describeRule, profileLabel } from "@/domain/approvals";

/**
 * Organigrama de las aprobaciones (ADR-076): una raíz («un cambio en un prompt»), una rama por paso (publicar y cada entorno)
 * y, bajo cada rama, los perfiles y las personas que tienen que aprobar. Solo dibuja; quien lo usa pone los botones en el slot.
 */
export interface FlowStep {
  action: "publish" | "promote";
  stage: string;
  label: string;
  /** la regla de este ámbito (en el prompt, la efectiva) */
  rule: ApprovalRuleDto | null;
  /** el suelo que pone la organización, si se muestra aparte */
  floor?: ApprovalRuleDto | null;
  open?: boolean;
}

const props = defineProps<{ steps: FlowStep[]; names: Record<string, string>; testPrefix: string }>();

interface Person { key: string; label: string; kind: "role" | "approver"; inherited: boolean }

const hasRule = (s: FlowStep) => !!s.rule || !!s.floor;

/** Los nodos de un paso: cuántos de cada perfil y las personas obligatorias, marcando lo heredado de la organización. */
function peopleOf(step: FlowStep): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const [rule, inherited] of [[step.floor ?? null, true], [step.rule, false]] as const) {
    for (const r of rule?.requirements ?? []) {
      const key = `role:${r.role}`;
      if (inherited || !seen.has(key)) out.push({ key: key + inherited, label: `${r.min} × ${profileLabel(r.role)}`, kind: "role", inherited });
      if (inherited) seen.add(key);
    }
    for (const id of rule?.approvers ?? []) {
      const key = `approver:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: props.names[id] ?? "Someone", kind: "approver", inherited });
    }
  }
  return out;
}
const columns = computed(() => props.steps.map((step) => ({ step, people: peopleOf(step), id: `${step.action}-${step.stage || "publish"}` })));
</script>

<template>
  <div class="chart" role="group" aria-label="Who has to approve each step">
    <div class="root"><span class="root-node">A change to a prompt</span></div>
    <ul class="branches">
      <li v-for="c in columns" :key="c.id" class="branch" :class="{ open: c.step.open }" :data-testid="`${testPrefix}-${c.id}`">
        <div class="step" :class="{ none: !hasRule(c.step) }">
          <span class="step-title">{{ c.step.label }}</span>
          <span class="step-summary" data-testid="rule-summary">{{ describeRule(c.step.rule, names) }}</span>
          <span v-if="c.step.floor" class="step-floor" data-testid="rule-floor">Organization: {{ describeRule(c.step.floor, names) }}</span>
          <span v-if="$slots.actions" class="step-actions"><slot name="actions" :step="c.step" /></span>
        </div>
        <ul v-if="hasRule(c.step)" class="people">
          <li v-for="p in c.people" :key="p.key" class="person" :class="[p.kind, { inherited: p.inherited }]">
            <span class="who">{{ p.label }}</span>
            <span class="tag">{{ p.inherited ? "organization" : p.kind === "approver" ? "always" : "any of" }}</span>
          </li>
        </ul>
        <p v-else class="nobody">No approval</p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
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

</style>
