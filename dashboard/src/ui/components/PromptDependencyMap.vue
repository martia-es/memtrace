<script setup lang="ts">
import { computed, onMounted } from "vue";
import { describeApiError } from "@/application/describe-api-error";
import { formatRelativeTime } from "@/domain/format";
import { servingStatus, sortEnvironments } from "@/domain/prompt-release";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import EmptyState from "./EmptyState.vue";
import EnvFlag from "./EnvFlag.vue";

/**
 * Mapa de dependencias de un prompt (ADR-074): los agentes que lo leen y qué sirve cada uno por entorno, el dataset con el que
 * se evalúa antes de promover, los fragmentos que incluye y los prompts que lo incluyen a él.
 */
const props = withDefaults(defineProps<{ promptId: string; kind: "prompt" | "fragment"; tagVersions?: Record<string, number>; latest?: number; name?: string }>(), { tagVersions: () => ({}), latest: 0, name: "" });
const api = usePromptApi();
const map = useAsync((signal) => api.map(props.promptId, undefined, signal));
onMounted(() => void map.run());
const data = computed(() => map.data.value);
const empty = computed(() => !!data.value && data.value.agents.length === 0 && !data.value.dataset && data.value.includes.length === 0 && data.value.usedBy.length === 0);
const servingOf = <T extends { environment: string }>(serving: T[]): T[] => sortEnvironments(serving.map((s) => s.environment)).map((env) => serving.find((s) => s.environment === env)!);
const now = Date.now();
const lastSeen = (serving: { lastSeenAt: string }[]): string | null => serving.map((s) => s.lastSeenAt).sort().at(-1) ?? null;
/** Alturas (0-100) a las que cada tarjeta engancha su cable: reparto uniforme, como están apiladas. */
const wires = (n: number): number[] => Array.from({ length: n }, (_, i) => ((i + 0.5) / Math.max(1, n)) * 100);
</script>

<template>
  <div class="map" data-testid="dependency-map">
    <p v-if="map.error.value" class="problem" role="alert">{{ describeApiError(map.error.value) }}</p>
    <p v-else-if="!data" class="soft">Loading…</p>
    <EmptyState v-else-if="empty" icon="hub" title="Nothing depends on this yet">Link it to an agent, give it a promotion policy or include a fragment, and it shows up here.</EmptyState>
    <template v-else>
      <div class="flow">
        <div class="col">
          <span class="eyebrow">FRAGMENTS IT INCLUDES</span>
          <section v-if="data.includes.length > 0" class="stack" data-testid="map-includes">
            <article v-for="i in data.includes" :key="i.name + i.ref" class="item" :class="{ out: i.outdated }">
              <b class="mono">{{ i.name }}@{{ i.ref }}</b>
              <span class="line">
                <span>pinned to <b class="mono">v{{ i.pinned }}</b></span>
                <span v-if="i.outdated" class="pill out">now v{{ i.current }}</span>
                <span v-else class="pill ok">current</span>
              </span>
            </article>
          </section>
          <p v-else class="soft empty">No fragments.</p>
        </div>

        <svg class="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path v-for="(y, i) in wires(data.includes.length)" :key="i" :d="`M 0 ${y} C 55 ${y}, 45 50, 100 50`" />
        </svg>

        <div class="node">
          <span class="eyebrow tint">{{ kind === "prompt" ? "THIS PROMPT" : "THIS FRAGMENT" }}</span>
          <b v-if="name" class="node-name">{{ name }}</b>
          <span v-if="latest > 0" class="mono node-latest">latest v{{ latest }}</span>
        </div>

        <svg class="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path v-for="(y, i) in wires(kind === 'prompt' ? data.agents.length : data.usedBy.length)" :key="i" :d="`M 0 50 C 55 50, 45 ${y}, 100 ${y}`" />
        </svg>

        <div class="col">
          <template v-if="kind === 'prompt'">
            <span class="eyebrow">AGENTS THAT READ IT</span>
            <section class="stack" data-testid="map-agents">
              <p v-if="data.agents.length === 0" class="soft">No agent is linked. Link one from the prompt's settings.</p>
              <article v-for="a in data.agents" :key="a.experimentId" class="item" :data-testid="`map-agent-${a.name}`">
                <span class="agent-head">
                  <b>{{ a.name }}</b>
                  <span v-if="lastSeen(a.serving)" class="soft">seen {{ formatRelativeTime(lastSeen(a.serving)!, now) }}</span>
                </span>
                <span v-if="a.serving.length === 0" class="soft">has not reported reading it yet</span>
                <span v-for="s in servingOf(a.serving)" :key="s.environment" class="serving" :title="s.tag ? `follows “${s.tag}”` : 'fixed version'">
                  <EnvFlag :env="s.environment || 'none'" />
                  <b class="mono">v{{ s.version }}</b>
                  <b v-if="latest > 0" class="pill" :class="servingStatus(s, tagVersions, latest).state" :data-testid="`map-status-${a.name}-${s.environment}`">{{ servingStatus(s, tagVersions, latest).label }}</b>
                </span>
              </article>
            </section>
          </template>
          <template v-else>
            <span class="eyebrow">PROMPTS THAT INCLUDE IT</span>
            <section class="stack" data-testid="map-used-by">
              <p v-if="data.usedBy.length === 0" class="soft">None yet.</p>
              <article v-for="u in data.usedBy" :key="u.promptId" class="item">
                <span class="line"><b>{{ u.name }}</b> <span class="soft">v{{ u.version }}</span><span v-if="u.outdated" class="pill out">behind</span></span>
              </article>
            </section>
          </template>
        </div>
      </div>

      <template v-if="kind === 'prompt'">
        <div class="drop" aria-hidden="true" />
        <section class="dataset" data-testid="map-dataset">
          <span class="ds-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></svg>
          </span>
          <div class="ds-body">
            <span class="eyebrow">EVALUATED WITH</span>
            <p v-if="!data.dataset" class="soft">No promotion policy: any version can be promoted without an evaluation.</p>
            <p v-else>
              <b>{{ data.dataset.name }}</b> · {{ data.dataset.requiredRuns }} {{ data.dataset.requiredRuns === 1 ? "run" : "runs" }} must pass before <b class="mono">pre</b> or <b class="mono">pro</b>
            </p>
          </div>
          <router-link v-if="data.dataset" class="ghost-link" :to="{ name: 'dataset', params: { experimentId: data.dataset.experimentId, datasetId: data.dataset.id } }">Open dataset</router-link>
        </section>
      </template>
      <p class="soft">Fragments flow into the prompt, the prompt flows to the agents that read it. Outdated fragments are marked in coral.</p>
    </template>
  </div>
</template>

<style scoped>
.map { display: flex; flex-direction: column; gap: 12px; }
.flow { display: grid; grid-template-columns: minmax(0, 1fr) 60px 170px 60px minmax(0, 1fr); align-items: stretch; padding: 20px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); }
.col { display: flex; flex-direction: column; gap: 10px; }
.stack { display: flex; flex-direction: column; gap: 10px; flex: 1; justify-content: center; }
.item { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); font-size: 13px; }
.item.out { border-color: var(--mt-highlight); }
.line { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--mt-muted); }
.agent-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.serving { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.pill { padding: 2px 8px; border-radius: var(--mt-radius-xs); font-size: 11.5px; font-weight: 700; }
.pill.ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.pill.out, .pill.behind, .pill.catching-up { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.wires { width: 100%; height: 100%; min-height: 40px; align-self: stretch; overflow: visible; }
.wires path { fill: none; stroke: var(--mt-accent-soft); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.node { align-self: center; min-height: 140px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 12px; text-align: center; border: 1.5px solid var(--mt-brand); border-radius: 12px; background: var(--mt-accent-tint); }
.node-name { font-size: 15px; }
.node-latest { font-size: 11.5px; color: var(--mt-muted); }
.drop { align-self: center; width: 0; height: 28px; border-left: 1.5px dashed var(--mt-accent-soft); margin: -4px 0; }
.dataset { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); }
.ds-icon { flex: none; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px; background: var(--mt-accent-tint); color: var(--mt-accent-text); }
.ds-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.dataset p { margin: 0; font-size: 13.5px; }
.ghost-link { flex: none; padding: 7px 14px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); color: var(--mt-ink); font-size: 12.5px; font-weight: 600; text-decoration: none; }
.eyebrow { font-family: var(--mt-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--mt-faint); }
.eyebrow.tint { color: var(--mt-accent-text); }
.soft { color: var(--mt-muted); font-size: 12px; margin: 0; }
.empty { padding: 4px 0; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
@media (max-width: 1000px) {
  .flow { grid-template-columns: 1fr; gap: 16px; }
  .wires { display: none; }
  .node { min-height: 72px; }
}
</style>
