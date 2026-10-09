<script setup lang="ts">
import { computed } from "vue";
import type { ApprovalRuleDto } from "@contract";
import { describeRule, profileLabel } from "@/domain/approvals";

/**
 * El recorrido de un cambio de prompt (ADR-076), de izquierda a derecha: publicar una versión y mover cada entorno. Cada
 * paso es una tarjeta con quién tiene que aprobar: un perfil (cualquier persona que lo tenga) o una persona concreta que
 * aprueba siempre. Solo dibuja; quien lo usa pone el botón en el slot y decide qué paso está seleccionado.
 */
export interface FlowStep {
  action: "publish" | "promote";
  stage: string;
  label: string;
  /** la regla de este ámbito (en el prompt, la efectiva) */
  rule: ApprovalRuleDto | null;
  /** el suelo que pone la organización, si se muestra aparte */
  floor?: ApprovalRuleDto | null;
  /** el paso que se está editando */
  open?: boolean;
}

const props = defineProps<{ steps: FlowStep[]; names: Record<string, string>; testPrefix: string }>();

interface Need { key: string; kind: "role" | "person"; mark: string; label: string; tag: string }

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const SUBTITLE: Record<string, string> = { publish: "A new version becomes available only after review.", dev: "First environment, for trying changes.", pre: "Close to production.", pro: "What your users get." };

/** Los nodos de un paso: cuántas personas de cada perfil y las personas obligatorias, marcando lo que viene de la organización. */
function needsOf(step: FlowStep): Need[] {
  const out: Need[] = [];
  const seen = new Set<string>();
  for (const [rule, inherited] of [[step.floor ?? null, true], [step.rule, false]] as const) {
    for (const r of rule?.requirements ?? []) {
      const key = `role:${r.role}`;
      if (!inherited && seen.has(key)) continue;
      seen.add(key);
      out.push({ key: key + inherited, kind: "role", mark: profileLabel(r.role)[0]!, label: `${r.min} ${profileLabel(r.role)}`, tag: inherited ? "organization" : "any person" });
    }
    for (const id of rule?.approvers ?? []) {
      const key = `approver:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = props.names[id] ?? "Someone";
      out.push({ key, kind: "person", mark: initials(name), label: name, tag: inherited ? "organization" : "always" });
    }
  }
  return out;
}

const cards = computed(() =>
  props.steps.map((step) => {
    const needs = needsOf(step);
    const env = step.action === "publish" ? "publish" : step.stage;
    return { step, needs, env, id: `${step.action}-${step.stage || "publish"}`, title: step.action === "publish" ? step.label : step.label, sub: SUBTITLE[env] ?? "An environment of your assistant." };
  }),
);
</script>

<template>
  <ol class="flow" role="group" aria-label="Who has to approve each step">
    <li v-for="(c, i) in cards" :key="c.id" class="stop">
      <span v-if="i > 0" class="arrow" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </span>
      <div class="card" :class="{ open: c.step.open, none: c.needs.length === 0 }" :data-testid="`${testPrefix}-${c.id}`">
        <div class="top">
          <span class="env" :class="`env-${c.env === 'publish' ? 'publish' : ['dev', 'pre', 'pro'].includes(c.env) ? c.env : 'other'}`">{{ c.env === "publish" ? "PUBLISH" : c.env }}</span>
          <span class="count" :class="{ off: c.needs.length === 0 }">{{ c.needs.length === 0 ? "No approval" : `${c.needs.length} approval${c.needs.length > 1 ? "s" : ""}` }}</span>
        </div>
        <div class="head">
          <span class="title">{{ c.title }}</span>
          <span class="sub">{{ c.sub }}</span>
        </div>
        <ul class="needs">
          <li v-if="c.needs.length === 0" class="empty">Nobody has to approve. Whoever can do this does it straight away.</li>
          <li v-for="n in c.needs" :key="n.key" class="need">
            <span class="mark" :class="n.kind">{{ n.mark }}</span>
            <span class="label">{{ n.label }}</span>
            <span class="tag">{{ n.tag }}</span>
          </li>
        </ul>
        <!-- los datos de siempre, para quien los lea como texto -->
        <span class="sr" data-testid="rule-summary">{{ describeRule(c.step.rule, names) }}</span>
        <span v-if="c.step.floor" class="floor" data-testid="rule-floor">Organization: {{ describeRule(c.step.floor, names) }}</span>
        <div v-if="$slots.actions" class="actions"><slot name="actions" :step="c.step" /></div>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.flow { display: flex; align-items: stretch; margin: 0; padding: 0; list-style: none; overflow-x: auto; }
.stop { display: flex; align-items: stretch; flex: 1 1 0; min-width: 220px; }
.arrow { flex: none; width: 36px; display: flex; align-items: center; justify-content: center; color: var(--mt-muted); }
.card { flex: 1; min-width: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: var(--mt-surface, transparent); border: 1px solid var(--mt-line); border-radius: 10px; }
.card.none { border-style: dashed; }
.card.open { border: 2px solid var(--mt-accent, var(--mt-ink)); padding: 13px 15px; box-shadow: 0 0 0 4px var(--mt-soft); }
.top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.env { height: 22px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 4px; font: 800 11px/1 var(--mt-mono, monospace); letter-spacing: 0.04em; background: var(--mt-soft); color: var(--mt-muted); }
.env-publish { background: var(--mt-accent-soft, var(--mt-soft)); color: var(--mt-ink); }
.env-pre { background: var(--mt-warn-bg, var(--mt-soft)); color: var(--mt-warn-ink, var(--mt-ink)); }
.env-pro { background: var(--mt-accent, var(--mt-ink)); color: var(--mt-accent-ink, #fff); }
.count { font-size: 12px; font-weight: 700; color: var(--mt-ink); }
.count.off { color: var(--mt-muted); }
.head { display: flex; flex-direction: column; gap: 3px; }
.title { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; color: var(--mt-ink); }
.sub { font-size: 12px; line-height: 1.45; color: var(--mt-muted); }
.needs { display: flex; flex-direction: column; gap: 8px; flex: 1; margin: 0; padding: 0; list-style: none; }
.empty { padding: 10px 12px; border: 1px dashed var(--mt-line); border-radius: 6px; font-size: 12.5px; line-height: 1.45; color: var(--mt-muted); }
.need { display: flex; align-items: center; gap: 10px; height: 36px; padding: 0 10px; box-sizing: border-box; border-radius: 6px; background: var(--mt-soft); }
.mark { flex: none; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; border-radius: 4px; background: var(--mt-accent-soft, var(--mt-line)); color: var(--mt-ink); }
.mark.person { border-radius: 50%; font-size: 8.5px; background: var(--mt-warn-bg, var(--mt-line)); }
.label { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--mt-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tag { font-size: 11px; font-weight: 700; color: var(--mt-muted); }
.floor { font-size: 11.5px; color: var(--mt-muted); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.actions { display: flex; gap: 8px; }
</style>
