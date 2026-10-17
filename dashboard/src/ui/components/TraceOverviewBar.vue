<script setup lang="ts">
import { computed } from "vue";
import { formatCostUsd, formatCount, formatDuration } from "@/domain/format";
import type { SpanFilter, TraceSummary } from "@/domain/trace-summary";
import Switch from "./Switch.vue";
import ToggleChip from "./ToggleChip.vue";
import { t, tp } from "../i18n";

/**
 * The top of the Technical trace tab: what happened in one line of numbers, the slowest step, and the filters that
 * narrow the waterfall (a type of step, or only the failures). The guardrail checks fold into one row unless asked.
 */
const props = defineProps<{ summary: TraceSummary; tokens: number; costUsd: number; filter: SpanFilter; groupGuardrails: boolean }>();
const emit = defineEmits<{ "update:filter": [value: SpanFilter]; "update:groupGuardrails": [value: boolean]; "select-slowest": [spanId: string] }>();

const stats = computed(() => {
  const s = props.summary;
  const cost = formatCostUsd(props.costUsd);
  return [
    { k: t("traceOverviewBar.spans"), v: formatCount(s.spans), sub: "", tone: "" },
    { k: t("traceOverviewBar.model_calls"), v: String(s.modelCalls), sub: [props.tokens ? t("traceOverviewBar.count_tokens", { count: formatCount(props.tokens) }) : null, cost].filter(Boolean).join(" · "), tone: "" },
    { k: t("traceOverviewBar.tools"), v: String(s.tools), sub: s.retrievals ? tp("traceOverviewBar.retrievals", s.retrievals) : "", tone: "" },
    {
      k: t("traceOverviewBar.guardrails"),
      v: s.guardrails.total === 0 && s.guardrails.failed === 0 ? "–" : s.guardrails.failed ? t("traceOverviewBar.count_blocked", { count: s.guardrails.failed }) : t("traceOverviewBar.count_passed", { count: s.guardrails.total }),
      sub: "",
      tone: s.guardrails.failed ? "bad" : s.guardrails.total ? "good" : "",
    },
    { k: t("traceOverviewBar.errors"), v: String(s.errors), sub: "", tone: s.errors ? "bad" : "good" },
  ];
});

const chips = computed(() => {
  const s = props.summary;
  return [
    { value: "all" as const, label: "All", count: s.spans },
    { value: "llm" as const, label: t("traceOverviewBar.model_calls"), count: s.modelCalls },
    { value: "tool" as const, label: t("traceOverviewBar.tools"), count: s.tools },
    { value: "retriever" as const, label: t("traceOverviewBar.retrieval"), count: s.retrievals },
    { value: "guardrail" as const, label: t("traceOverviewBar.guardrails"), count: s.guardrails.total + s.guardrails.failed },
    { value: "error" as const, label: t("traceOverviewBar.errors"), count: s.errors },
  ].filter((c) => c.value === "all" || c.value === "error" || c.count > 0);
});
</script>

<template>
  <section class="overview" :aria-label="t('traceOverviewBar.trace_overview')" data-testid="trace-overview">
    <div class="strip">
      <div v-for="s in stats" :key="s.k" class="stat">
        <span class="k">{{ s.k }}</span>
        <span class="v mono" :class="s.tone">{{ s.v }}</span>
        <span v-if="s.sub" class="sub">{{ s.sub }}</span>
      </div>
      <button v-if="summary.slowest" type="button" class="stat slowest" data-testid="slowest-step" @click="emit('select-slowest', summary.slowest.spanId)">
        <span class="k">{{ t("traceOverviewBar.slowest_step") }}</span>
        <span class="v mono">{{ formatDuration(summary.slowest.durationMs) }}</span>
        <span class="sub">{{ summary.slowest.name }} · {{ t("traceOverviewBar.percent_of_the_time", { percent: Math.round(summary.slowest.share * 100) }) }}</span>
      </button>
    </div>
    <div class="filters">
      <ToggleChip v-for="c in chips" :key="c.value" :pressed="filter === c.value" :count="c.count" :data-testid="`filter-${c.value}`" @click="emit('update:filter', c.value)">{{ c.label }}</ToggleChip>
      <span class="grow" />
      <label class="group">
        <Switch :on="groupGuardrails" :aria-label="t('traceOverviewBar.group_guardrail_checks')" data-testid="group-guardrails" @click="emit('update:groupGuardrails', !groupGuardrails)" />
        <span>{{ t("traceOverviewBar.group_guardrails") }}</span>
      </label>
    </div>
  </section>
</template>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
}
.strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-lg);
  background: var(--mt-card);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 10px 16px;
  border: 0;
  border-left: 1px solid var(--mt-line-2);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
.stat:first-child {
  border-left: 0;
}
button.stat {
  cursor: pointer;
}
button.stat:hover {
  background: var(--mt-soft-2);
}
button.stat:focus-visible {
  outline: 2px solid var(--mt-accent);
  outline-offset: -2px;
}
.k {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.v {
  font-size: 15px;
  font-weight: 800;
}
.v.good {
  color: var(--mt-ok-ink);
}
.v.bad {
  color: var(--mt-err-ink);
}
.sub {
  font-size: 11.5px;
  color: var(--mt-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.grow {
  flex: 1;
}
.group {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--mt-muted);
  cursor: pointer;
}
</style>
