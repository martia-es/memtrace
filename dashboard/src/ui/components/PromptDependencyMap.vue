<script setup lang="ts">
import { computed, onMounted } from "vue";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime } from "@/domain/format";
import { servingStatus, sortEnvironments } from "@/domain/prompt-release";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import EmptyState from "./EmptyState.vue";

/**
 * Mapa de dependencias de un prompt (ADR-074): los agentes que lo leen y qué sirve cada uno por entorno, el dataset con el que
 * se evalúa antes de promover, los fragmentos que incluye y los prompts que lo incluyen a él.
 */
const props = withDefaults(defineProps<{ promptId: string; kind: "prompt" | "fragment"; tagVersions?: Record<string, number>; latest?: number }>(), { tagVersions: () => ({}), latest: 0 });
const api = usePromptApi();
const map = useAsync((signal) => api.map(props.promptId, undefined, signal));
onMounted(() => void map.run());
const data = computed(() => map.data.value);
const empty = computed(() => !!data.value && data.value.agents.length === 0 && !data.value.dataset && data.value.includes.length === 0 && data.value.usedBy.length === 0);
const servingOf = <T extends { environment: string }>(serving: T[]): T[] => sortEnvironments(serving.map((s) => s.environment)).map((env) => serving.find((s) => s.environment === env)!);
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
              <span class="line"><span>pinned to <b class="mono">v{{ i.pinned }}</b></span><span v-if="i.outdated" class="mt-pill draft-pill">now v{{ i.current }}</span></span>
            </article>
          </section>
          <p v-else class="soft empty">No fragments.</p>
        </div>

        <div class="node"><span class="eyebrow tint">{{ kind === "prompt" ? "THIS PROMPT" : "THIS FRAGMENT" }}</span></div>

        <div class="col">
          <template v-if="kind === 'prompt'">
            <span class="eyebrow">AGENTS THAT READ IT</span>
            <section class="stack" data-testid="map-agents">
              <p v-if="data.agents.length === 0" class="soft">No agent is linked. Link one from the prompt's settings.</p>
              <article v-for="a in data.agents" :key="a.experimentId" class="item" :data-testid="`map-agent-${a.name}`">
                <b>{{ a.name }}</b>
                <span v-if="a.serving.length === 0" class="soft">has not reported reading it yet</span>
                <span v-for="s in servingOf(a.serving)" :key="s.environment" class="mt-pill tag" :class="s.environment">
                  {{ s.environment || "no environment" }} · {{ s.tag ? `${s.tag} → ` : "fixed " }}v{{ s.version }}
                  <span class="soft">· {{ formatDateTime(s.lastSeenAt) }}</span>
                  <b v-if="latest > 0" class="status" :class="servingStatus(s, tagVersions, latest).state" :data-testid="`map-status-${a.name}-${s.environment}`">{{ servingStatus(s, tagVersions, latest).label }}</b>
                </span>
              </article>
            </section>
          </template>
          <template v-else>
            <span class="eyebrow">PROMPTS THAT INCLUDE IT</span>
            <section class="stack" data-testid="map-used-by">
              <p v-if="data.usedBy.length === 0" class="soft">None yet.</p>
              <article v-for="u in data.usedBy" :key="u.promptId" class="item">
                <span class="line"><b>{{ u.name }}</b> <span class="soft">v{{ u.version }}</span><span v-if="u.outdated" class="mt-pill draft-pill">behind</span></span>
              </article>
            </section>
          </template>
        </div>
      </div>

      <section v-if="kind === 'prompt'" class="dataset" data-testid="map-dataset">
        <span class="eyebrow">EVALUATED WITH</span>
        <p v-if="!data.dataset" class="soft">No promotion policy: any version can be promoted without an evaluation.</p>
        <p v-else>
          Dataset <b>{{ data.dataset.name }}</b>, {{ data.dataset.requiredRuns }} {{ data.dataset.requiredRuns === 1 ? "run" : "runs" }} passing before <code>pre</code> or <code>pro</code>.
        </p>
      </section>
      <p class="soft">Fragments flow into the prompt and the prompt flows to whoever reads it. An outdated fragment is marked in coral.</p>
    </template>
  </div>
</template>

<style scoped>
.map { display: flex; flex-direction: column; gap: 12px; }
.flow { display: grid; grid-template-columns: minmax(0, 1fr) 150px minmax(0, 1.2fr); gap: 0; align-items: center; padding: 20px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); }
.col { display: flex; flex-direction: column; gap: 10px; align-self: start; }
.stack { display: flex; flex-direction: column; gap: 10px; }
.item { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); font-size: 13px; }
.item.out { border-color: var(--mt-highlight); }
.line { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--mt-muted); }
.node { position: relative; margin: 0 28px; min-height: 110px; display: flex; align-items: center; justify-content: center; border: 1.5px solid var(--mt-brand); border-radius: 12px; background: var(--mt-accent-tint); }
.node::before, .node::after { content: "→"; position: absolute; top: 50%; transform: translateY(-50%); color: var(--mt-faint); font-size: 16px; }
.node::before { left: -24px; }
.node::after { right: -24px; }
.dataset { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); }
.dataset p { margin: 0; font-size: 13.5px; }
.status { margin-left: 4px; font-weight: 800; font-size: 11px; }
.status.ok { color: var(--mt-ok-ink); }
.status.catching-up, .status.behind { color: var(--mt-highlight-ink); }
.eyebrow { font-family: var(--mt-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--mt-faint); }
.eyebrow.tint { color: var(--mt-accent-text); }
.soft { color: var(--mt-muted); font-size: 12px; margin: 0; }
.empty { padding: 4px 0; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
@media (max-width: 1000px) {
  .flow { grid-template-columns: 1fr; gap: 16px; }
  .node { margin: 0; min-height: 56px; }
  .node::before, .node::after { display: none; }
}
</style>
