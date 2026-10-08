<script setup lang="ts">
import { computed, ref } from "vue";
import type { ErrorOverviewResponse } from "@contract";
import { formatCount, formatRelativeTime } from "@/domain/format";
import { errorTrend, impactLabel } from "@/domain/error-overview";

const props = defineProps<{ overview: ErrorOverviewResponse }>();
defineEmits<{ view: [] }>();

const open = ref<string | null>(null);
const comparable = computed(() => props.overview.previousRange !== null);
const rows = computed(() =>
  props.overview.categories.map((c) => ({
    ...c,
    impact: impactLabel(c.conversations, props.overview.totals.totalConversations, c.traces),
    trend: errorTrend(c.occurrences, c.previousOccurrences, comparable.value),
    last: formatRelativeTime(c.lastSeen, Date.now()),
    parts: c.affected.map((a) => a.name).join(", "),
  })),
);
const severityLabel = { high: "High impact", medium: "Medium impact", low: "Low impact" } as const;
</script>

<template>
  <section class="card error-overview" aria-label="What is going wrong" data-testid="error-overview">
    <div class="card-head">
      <h2>What is going wrong</h2>
      <span class="spacer" />
      <a class="card-link" @click="$emit('view')">View failed conversations →</a>
    </div>
    <p class="intro">
      {{ formatCount(overview.totals.occurrences) }} {{ overview.totals.occurrences === 1 ? "failure" : "failures" }} grouped by cause.
    </p>
    <div v-for="c in rows" :key="c.id" class="cause" :class="c.severity" data-testid="error-category">
      <button type="button" class="cause-head" :aria-expanded="open === c.id" @click="open = open === c.id ? null : c.id">
        <span class="sev" :class="c.severity">{{ severityLabel[c.severity] }}</span>
        <span class="cause-text">
          <strong>{{ c.title }}</strong>
          <span>{{ c.impact }} · last seen {{ c.last }}<template v-if="c.parts"> · {{ c.parts }}</template></span>
        </span>
        <span v-if="c.trend" class="trend" :class="c.trend.kind" data-testid="error-trend">{{ c.trend.label }}</span>
        <span class="count">{{ formatCount(c.occurrences) }}×</span>
      </button>
      <div v-if="open === c.id" class="cause-body">
        <p>{{ c.explanation }}</p>
        <p><strong>What to do:</strong> {{ c.action }}</p>
        <p v-if="c.sample" class="sample">Technical detail: <code>{{ c.sample }}</code></p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.error-overview { gap: 0; padding: 0; }
.card-head { padding: 12px 16px 0; }
.intro { margin: 2px 16px 10px; font-size: 12px; color: var(--mt-muted); }
.cause { border-top: 1px solid var(--mt-border, rgba(128, 128, 128, 0.2)); }
.cause-head { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 16px; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.cause-head:hover { background: var(--mt-soft-2); }
.cause-text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.cause-text strong { font-weight: 700; }
.cause-text span { font-size: 12px; color: var(--mt-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sev { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }
.sev.high { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.sev.medium { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.sev.low { background: var(--mt-soft-2); color: var(--mt-muted); }
.trend { font-size: 12px; font-weight: 700; white-space: nowrap; color: var(--mt-muted); }
.trend.up, .trend.new { color: var(--mt-err-ink); }
.trend.down { color: var(--mt-ok-ink); }
.count { min-width: 44px; text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
.cause-body { padding: 0 16px 12px 16px; font-size: 13px; }
.cause-body p { margin: 4px 0; }
.sample { color: var(--mt-muted); font-size: 12px; }
.sample code { word-break: break-word; }
@media (max-width: 700px) { .trend { display: none; } }
</style>
