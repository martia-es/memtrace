<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { PromptGraphResponse } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import { useAsync } from "../composables/useAsync";
import { usePromptApi } from "../composables/usePromptApi";
import { t } from "../i18n";

/**
 * Grafo global de los prompts y fragmentos de un agente (ADR-073/074): a la izquierda los fragmentos, a la derecha los prompts
 * y, en cada cable, la referencia y la versión fijada. Solo lee; pulsar un nodo abre su detalle.
 */
const props = defineProps<{ experimentId: string }>();
const api = usePromptApi();
const graph = useAsync((signal) => api.graph(props.experimentId, signal));
onMounted(() => void graph.run());

const NODE_H = 72;
const GAP = 16;
type Node = PromptGraphResponse["nodes"][number];
type Edge = PromptGraphResponse["edges"][number];

const fragments = computed(() => (graph.data.value?.nodes ?? []).filter((n) => n.kind === "fragment"));
const prompts = computed(() => (graph.data.value?.nodes ?? []).filter((n) => n.kind === "prompt"));
const edges = computed(() => graph.data.value?.edges ?? []);
const rows = computed(() => Math.max(fragments.value.length, prompts.value.length, 1));
const height = computed(() => rows.value * NODE_H + (rows.value - 1) * GAP);

/** Altura del centro de cada nodo: las dos columnas se centran en la altura total, como están apiladas. */
function centers(list: Node[]): Map<string, number> {
  const used = list.length * NODE_H + (list.length - 1) * GAP;
  const top = (height.value - used) / 2;
  return new Map(list.map((n, i) => [n.id, top + i * (NODE_H + GAP) + NODE_H / 2]));
}
const fragmentY = computed(() => centers(fragments.value));
const promptY = computed(() => centers(prompts.value));

interface Wire { key: string; d: string; midY: number; edge: Edge; fragment: Node | undefined; prompt: Node | undefined }
const wires = computed<Wire[]>(() =>
  edges.value.flatMap((edge) => {
    const from = fragmentY.value.get(edge.fragmentId);
    const to = promptY.value.get(edge.promptId);
    if (from === undefined || to === undefined) return [];
    return [{
      key: `${edge.fragmentId}-${edge.promptId}-${edge.ref}`,
      d: `M 0 ${from} C 50 ${from}, 50 ${to}, 100 ${to}`,
      midY: (from + to) / 2,
      edge,
      fragment: fragments.value.find((f) => f.id === edge.fragmentId),
      prompt: prompts.value.find((p) => p.id === edge.promptId),
    }];
  }),
);

const usedFragments = computed(() => new Set(edges.value.map((e) => e.fragmentId)));
const hovered = ref<string | null>(null);
const linked = (wire: Wire) => hovered.value === null || wire.edge.fragmentId === hovered.value || wire.edge.promptId === hovered.value;
const dimNode = (id: string) => hovered.value !== null && hovered.value !== id && !wires.value.some((w) => linked(w) && (w.edge.fragmentId === id || w.edge.promptId === id));
const countOf = (id: string) => wires.value.filter((w) => w.edge.fragmentId === id || w.edge.promptId === id).length;
const visible = computed(() => fragments.value.length > 0);
</script>

<template>
  <section v-if="visible || graph.error.value" class="graph" data-testid="prompt-graph">
    <header class="head">
      <h2>{{ t("promptGraph.title") }}</h2>
      <span class="soft">{{ t("promptGraph.sub") }}</span>
      <span class="grow" />
      <span class="key"><i class="line ok" />{{ t("promptGraph.in_sync") }}</span>
      <span class="key"><i class="line late" />{{ t("promptGraph.newer") }}</span>
      <span class="key"><i class="line none" />{{ t("promptGraph.unused") }}</span>
    </header>
    <p v-if="graph.error.value" class="problem" role="alert">{{ describeApiError(graph.error.value) }}</p>
    <div v-else class="canvas">
      <div class="flow" :style="{ height: `${height}px` }">
        <div class="col" data-testid="graph-fragments">
          <router-link
            v-for="f in fragments"
            :key="f.id"
            :to="{ name: 'prompt', params: { experimentId, promptId: f.id } }"
            class="node"
            :class="{ unused: !usedFragments.has(f.id), dim: dimNode(f.id) }"
            :data-testid="`graph-node-${f.name}`"
            @mouseenter="hovered = f.id"
            @mouseleave="hovered = null"
            @focus="hovered = f.id"
            @blur="hovered = null"
          >
            <b>{{ f.name }}</b>
            <span class="mono sub">v{{ f.latestVersion }} · {{ usedFragments.has(f.id) ? countOf(f.id) + " →" : t("promptGraph.unused_note") }}</span>
          </router-link>
        </div>

        <div class="mid">
          <svg :viewBox="`0 0 100 ${height}`" preserveAspectRatio="none" aria-hidden="true" :style="{ height: `${height}px` }">
            <path v-for="w in wires" :key="w.key" :d="w.d" class="wire" :class="{ late: w.edge.outdated, off: !linked(w) }" :data-testid="`graph-wire-${w.fragment?.name}-${w.prompt?.name}`" />
          </svg>
          <span v-for="w in wires" :key="`pill-${w.key}`" class="pill mono" :class="{ late: w.edge.outdated, off: !linked(w) }" :style="{ top: `${w.midY}px` }">
            <i class="dot" :class="w.edge.outdated ? 'late' : 'ok'" />{{ t("promptGraph.pinned", { ref: "@" + w.edge.ref, version: w.edge.pinned }) }}<b v-if="w.edge.outdated && w.edge.current !== null">{{ t("promptGraph.newer_pill", { version: w.edge.current }) }}</b>
          </span>
        </div>

        <div class="col" data-testid="graph-prompts">
          <router-link
            v-for="p in prompts"
            :key="p.id"
            :to="{ name: 'prompt', params: { experimentId, promptId: p.id } }"
            class="node prompt"
            :class="{ dim: dimNode(p.id) }"
            :data-testid="`graph-node-${p.name}`"
            @mouseenter="hovered = p.id"
            @mouseleave="hovered = null"
            @focus="hovered = p.id"
            @blur="hovered = null"
          >
            <b>{{ p.name }}</b>
            <span class="mono sub">v{{ p.latestVersion }}</span>
          </router-link>
        </div>
      </div>
      <div class="cols" aria-hidden="true"><span class="eyebrow">{{ t("promptGraph.fragments") }}</span><span class="eyebrow">{{ t("promptGraph.prompts") }}</span></div>
      <p class="soft hint">{{ t("promptGraph.hint") }}</p>
    </div>
  </section>
</template>

<style scoped>
.graph { display: flex; flex-direction: column; gap: 12px; padding-bottom: 12px; }
.head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.head h2 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
.grow { flex: 1; }
.soft { color: var(--mt-muted); font-size: 12.5px; margin: 0; }
.key { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--mt-muted); }
.line { display: inline-block; width: 22px; height: 0; border-top: 2px solid var(--mt-accent); }
.line.late { border-top-color: var(--mt-highlight); }
.line.none { border-top: 2px dashed var(--mt-muted); }
.canvas { position: relative; padding: 18px 40px 14px; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); display: flex; flex-direction: column; gap: 12px; }
.cols { order: -1; display: flex; justify-content: space-between; }
.eyebrow { font-family: var(--mt-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--mt-muted); }
.flow { display: grid; grid-template-columns: 280px minmax(0, 1fr) 280px; }
.col { display: flex; flex-direction: column; justify-content: center; gap: 16px; }
.node { text-decoration: none; height: 72px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 0 16px; text-align: left; font: inherit; color: inherit; border: 1px solid var(--mt-line); border-radius: 10px; background: var(--mt-card); cursor: pointer; transition: opacity 0.12s ease; }
.node b { font-size: 14px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node.prompt { border: 1.5px solid var(--mt-brand); background: var(--mt-accent-tint); }
.node.unused { border-style: dashed; }
.node.dim { opacity: 0.35; }
.node:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
.sub { font-size: 11.5px; color: var(--mt-muted); }
.mid { position: relative; }
.mid svg { width: 100%; display: block; overflow: visible; }
.wire { fill: none; stroke: var(--mt-accent); stroke-width: 2; vector-effect: non-scaling-stroke; transition: opacity 0.12s ease; }
.wire.late { stroke: var(--mt-highlight); }
.wire.off, .pill.off { opacity: 0.15; }
.pill { position: absolute; left: 50%; transform: translate(-50%, -50%); display: inline-flex; align-items: center; gap: 8px; height: 26px; padding: 0 12px; border: 1px solid var(--mt-line); border-radius: 13px; background: var(--mt-card); font-size: 11.5px; white-space: nowrap; transition: opacity 0.12s ease; }
.pill.late { border-color: var(--mt-highlight); }
.pill b { font-family: var(--mt-font, inherit); font-weight: 800; color: var(--mt-highlight-ink); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mt-accent); }
.dot.late { background: var(--mt-highlight); }
.hint { align-self: flex-start; }
.problem { margin: 0; padding: 10px 12px; font-size: 13px; color: var(--mt-err-ink); background: var(--mt-err-bg); border-radius: var(--mt-radius-sm); }
@media (max-width: 900px) {
  .flow { grid-template-columns: 1fr; height: auto !important; gap: 16px; }
  .mid { display: none; }
}
</style>
