<script setup lang="ts">
import { computed, ref } from "vue";
import data from "../data/permissions.json";

/** Pick an organization role and an experiment role and see what the person can do (the union of both). */
const orgRoles = data.roles.filter((r) => r.scope === "Organization");
const experimentRoles = data.roles.filter((r) => r.scope === "Experiment");
const org = ref("org_admin");
const experiment = ref("technical");

const effective = computed(() => {
  const set = new Set<string>();
  for (const id of [org.value, experiment.value]) data.roles.find((r) => r.id === id)?.permissions.forEach((p) => set.add(p));
  return set;
});

const note = computed(() => {
  if (!org.value && !experiment.value) return "With no role at all the person does not even see the experiment (403).";
  if (!effective.value.has("experiment:read")) return "Without experiment:read the person cannot enter the experiment dashboard: in the app they land on Admin only, where they manage what their role allows.";
  if (org.value && experiment.value) return "Permissions are the union of both roles: the organization role applies to every experiment in the organization, the experiment role only to this one.";
  if (experiment.value === "business") return "A business profile reads traces as a conversation; the technical span tree and curation stay with the technical profile.";
  return "";
});

function preset(p: { org: string; experiment: string }) {
  org.value = p.org;
  experiment.value = p.experiment;
}
</script>

<template>
  <div class="ps">
    <div class="ps-pick">
      <label>Organization role
        <select v-model="org"><option value="">(none)</option><option v-for="r in orgRoles" :key="r.id">{{ r.id }}</option></select>
      </label>
      <label>Role in the experiment
        <select v-model="experiment"><option value="">(none)</option><option v-for="r in experimentRoles" :key="r.id">{{ r.id }}</option></select>
      </label>
      <span class="ps-presets">
        <button v-for="p in data.presets" :key="p.name" type="button" @click="preset(p)">{{ p.name }}</button>
      </span>
    </div>
    <div class="ps-label">Effective permissions</div>
    <div class="ps-chips">
      <code v-for="p in effective" :key="p">{{ p }}</code>
      <span v-if="!effective.size" class="ps-muted">None: no access to anything.</span>
    </div>
    <ul class="ps-acts">
      <li v-for="a in data.actions" :key="a.label" :class="effective.has(a.permission) ? 'ok' : 'no'">
        <b>{{ effective.has(a.permission) ? "✓" : "✕" }}</b>
        <span>{{ a.label }}</span>
        <small>{{ a.permission }}</small>
      </li>
    </ul>
    <p v-if="note" class="ps-note">{{ note }}</p>
  </div>
</template>

<style scoped>
.ps { margin: 18px 0; padding: 16px 18px; background: var(--mt-card); border: 1px solid var(--mt-line); border-top: 3px solid var(--mt-brand); border-radius: var(--mt-radius-lg); }
.ps-pick { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 24px; margin-bottom: 14px; }
.ps-pick label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--mt-muted); }
.ps-pick select { min-width: 180px; padding: 6px 10px; font: 13px var(--mt-sans); color: var(--mt-ink); background: var(--mt-bg); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.ps-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.ps-presets button { padding: 5px 10px; font: 700 12px var(--mt-sans); color: var(--mt-ink); background: var(--mt-bg); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); cursor: pointer; }
.ps-presets button:hover { border-color: var(--mt-accent); color: var(--mt-accent-text); }
.ps-label { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mt-muted); }
.ps-chips { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0 14px; }
.ps-chips code { padding: 2px 8px; font: 12px var(--mt-mono); color: var(--mt-accent-text); background: var(--mt-accent-tint); border-radius: var(--mt-radius-xs); }
.ps-muted { color: var(--mt-muted); font-size: 13px; }
.ps-acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 0 20px; margin: 0; padding: 0; list-style: none; }
.ps-acts li { display: flex; align-items: baseline; gap: 8px; margin: 0; padding: 5px 0; font-size: 13.5px; border-bottom: 1px dashed var(--mt-line); }
.ps-acts li b { width: 16px; flex: none; text-align: center; }
.ps-acts li.ok b { color: var(--mt-accent-text); }
.ps-acts li.no { color: var(--mt-muted); }
.ps-acts li.no b { color: var(--mt-danger); }
.ps-acts small { margin-left: auto; padding-left: 8px; font: 11px var(--mt-mono); color: var(--mt-faint); white-space: nowrap; }
.ps-note { margin: 12px 0 0; padding: 9px 12px; font-size: 13.5px; background: var(--mt-soft); border-radius: var(--mt-radius-sm); }
</style>
