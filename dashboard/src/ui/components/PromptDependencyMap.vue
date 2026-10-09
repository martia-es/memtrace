<script setup lang="ts">
import { computed, onMounted } from "vue";
import { describeApiError } from "@/application/describe-api-error";
import { formatDateTime } from "@/domain/format";
import { sortEnvironments } from "@/domain/prompt-release";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import EmptyState from "./EmptyState.vue";

/**
 * Mapa de dependencias de un prompt (ADR-074): los agentes que lo leen y qué sirve cada uno por entorno, el dataset con el que
 * se evalúa antes de promover, los fragmentos que incluye y los prompts que lo incluyen a él.
 */
const props = defineProps<{ promptId: string; kind: "prompt" | "fragment" }>();
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
      <section v-if="kind === 'prompt'" class="block" data-testid="map-agents">
        <span class="eyebrow">AGENTS THAT READ IT</span>
        <p v-if="data.agents.length === 0" class="soft">No agent is linked. Link one from the prompt's settings.</p>
        <article v-for="a in data.agents" :key="a.experimentId" class="agent" :data-testid="`map-agent-${a.name}`">
          <b>{{ a.name }}</b>
          <span v-if="a.serving.length === 0" class="soft">has not reported reading it yet</span>
          <span v-for="s in servingOf(a.serving)" :key="s.environment" class="mt-pill tag" :class="s.environment">
            {{ s.environment || "no environment" }} · {{ s.tag ? `${s.tag} → ` : "fixed " }}v{{ s.version }}
            <span class="soft">· {{ formatDateTime(s.lastSeenAt) }}</span>
          </span>
        </article>
      </section>

      <section v-if="kind === 'prompt'" class="block" data-testid="map-dataset">
        <span class="eyebrow">EVALUATED WITH</span>
        <p v-if="!data.dataset" class="soft">No promotion policy: any version can be promoted without an evaluation.</p>
        <p v-else>
          Dataset <b>{{ data.dataset.name }}</b>, {{ data.dataset.requiredRuns }} {{ data.dataset.requiredRuns === 1 ? "run" : "runs" }} passing before <code>pre</code> or <code>pro</code>.
        </p>
      </section>

      <section v-if="data.includes.length > 0" class="block" data-testid="map-includes">
        <span class="eyebrow">FRAGMENTS IT INCLUDES</span>
        <article v-for="i in data.includes" :key="i.name + i.ref" class="agent">
          <b class="mono">{{ i.name }}@{{ i.ref }}</b>
          <span>pinned to v{{ i.pinned }}</span>
          <span v-if="i.outdated" class="mt-pill draft-pill">now v{{ i.current }}</span>
        </article>
      </section>

      <section v-if="kind === 'fragment'" class="block" data-testid="map-used-by">
        <span class="eyebrow">PROMPTS THAT INCLUDE IT</span>
        <p v-if="data.usedBy.length === 0" class="soft">None yet.</p>
        <article v-for="u in data.usedBy" :key="u.promptId" class="agent">
          <b>{{ u.name }}</b> <span class="soft">v{{ u.version }}</span>
          <span v-if="u.outdated" class="mt-pill draft-pill">behind</span>
        </article>
      </section>
    </template>
  </div>
</template>

<style scoped>
.map { display: flex; flex-direction: column; gap: 18px; }
.block { display: flex; flex-direction: column; gap: 8px; }
.block p { margin: 0; font-size: 13.5px; }
.eyebrow { font-size: 11px; letter-spacing: 0.06em; color: var(--mt-muted); }
.agent { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--mt-line); background: var(--mt-card); font-size: 13.5px; }
.soft { color: var(--mt-muted); }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
</style>
