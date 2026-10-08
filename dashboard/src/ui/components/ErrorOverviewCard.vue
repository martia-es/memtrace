<script setup lang="ts">
import { computed, ref } from "vue";
import type { ErrorOverviewResponse } from "@contract";
import { formatCount, formatRelativeTime } from "@/domain/format";
import { errorTrend, impactLabel } from "@/domain/error-overview";

const props = defineProps<{ overview: ErrorOverviewResponse }>();
defineEmits<{ view: [] }>();

const open = ref<string | null>(null);
const comparable = computed(() => props.overview.previousRange !== null);
const icons = {
  high: "M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  medium: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  low: "M12 16v-4M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
} as const;
const rows = computed(() => {
  const { totalConversations, totalTraces } = props.overview.totals;
  return props.overview.categories.map((c) => {
    const share = totalConversations > 0 && c.conversations > 0 ? c.conversations / totalConversations : totalTraces > 0 ? c.traces / totalTraces : 0;
    return {
      ...c,
      impact: impactLabel(c.conversations, totalConversations, c.traces),
      share: Math.max(2, Math.min(100, Math.round(share * 100))),
      trend: errorTrend(c.occurrences, c.previousOccurrences, comparable.value),
      last: formatRelativeTime(c.lastSeen, Date.now()),
    };
  });
});
</script>

<template>
  <section class="card" aria-label="What is going wrong" data-testid="error-overview">
    <div class="head">
      <h2>What is going wrong</h2>
      <span class="count-badge">{{ rows.length }}</span>
      <span class="spacer" />
      <a class="link" @click="$emit('view')">View failed conversations →</a>
    </div>

    <div v-for="c in rows" :key="c.id" data-testid="error-category">
      <button type="button" class="row" :class="{ open: open === c.id }" :aria-expanded="open === c.id" @click="open = open === c.id ? null : c.id">
        <span class="tile" :class="c.severity" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path :d="icons[c.severity]" /></svg>
        </span>
        <span class="text">
          <strong>{{ c.title }}</strong>
          <span>{{ c.impact }} · last seen {{ c.last }}</span>
        </span>
        <span class="share" aria-hidden="true"><span class="track"><span class="fill" :class="c.severity" :style="{ width: `${c.share}%` }" /></span></span>
        <span class="trend" :class="c.trend?.kind" data-testid="error-trend">{{ c.trend?.label ?? "" }}</span>
        <span class="num">{{ formatCount(c.occurrences) }}×</span>
        <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      <div v-if="open === c.id" class="detail">
        <div class="col">
          <span class="label">What happened</span>
          <p>{{ c.explanation }}</p>
        </div>
        <div class="col">
          <span class="label">What to do</span>
          <p>{{ c.action }}</p>
        </div>
        <div class="col">
          <span class="label">Involved</span>
          <p class="chips"><span v-for="a in c.affected" :key="`${a.kind}:${a.name}`" class="chip">{{ a.name }}</span></p>
          <span v-if="c.sample" class="label tech">Technical detail</span>
          <code v-if="c.sample" class="sample">{{ c.sample }}</code>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.card { display: flex; flex-direction: column; min-width: 0; overflow: hidden; background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); }
.head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.head h2 { margin: 0; font-size: 14px; font-weight: 800; }
.count-badge { padding: 1px 7px; border-radius: var(--mt-radius-xs); background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); font-size: 11px; font-weight: 800; }
.spacer { flex: 1; }
.link { font-size: 12px; font-weight: 700; color: var(--mt-accent-text); cursor: pointer; }

.row { display: grid; grid-template-columns: 30px minmax(0, 1fr) 160px 150px 52px 14px; align-items: center; gap: 14px; width: 100%; padding: 10px 16px; border: 0; border-top: 1px solid var(--mt-line-2); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.row:hover, .row.open { background: var(--mt-soft-2); }
.tile { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--mt-radius-sm); }
.tile.high { background: var(--mt-err-bg); color: var(--mt-err-ink); }
.tile.medium { background: var(--mt-highlight-soft); color: var(--mt-highlight-ink); }
.tile.low { background: var(--mt-accent-soft); color: var(--mt-accent-text); }
.text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.text strong { font-weight: 700; }
.text span { font-size: 12px; color: var(--mt-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.track { display: block; height: 6px; border-radius: 3px; background: var(--mt-line-2); }
.fill { display: block; height: 6px; border-radius: 3px; background: var(--mt-accent); }
.fill.high { background: var(--mt-err); }
.fill.medium { background: var(--mt-highlight); }
.trend { font-size: 11.5px; font-weight: 700; color: var(--mt-muted); text-align: right; }
.trend.up, .trend.new { color: var(--mt-err-ink); }
.trend.down { color: var(--mt-ok-ink); }
.num { font-family: var(--mt-mono); font-size: 12px; font-weight: 500; text-align: right; }
.chev { color: var(--mt-faint); transition: transform 0.15s; }
.row.open .chev { transform: rotate(180deg); }

.detail { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; padding: 4px 16px 16px 60px; background: var(--mt-soft-2); }
.col { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.col p { margin: 0; }
.label { font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--mt-muted); }
.label.tech { margin-top: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 1px 7px; border-radius: var(--mt-radius-xs); background: var(--mt-soft); font-family: var(--mt-mono); font-size: 12px; }
.sample { font-family: var(--mt-mono); font-size: 12px; color: var(--mt-muted); word-break: break-word; }

@media (max-width: 900px) {
  .row { grid-template-columns: 30px minmax(0, 1fr) 52px 14px; }
  .share, .trend { display: none; }
  .detail { grid-template-columns: minmax(0, 1fr); gap: 12px; padding-left: 16px; }
}
</style>
