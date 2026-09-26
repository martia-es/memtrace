<script setup lang="ts">
import type { SpanNodeDto } from "@contract";
import { computed, ref, watch } from "vue";
import { formatDuration } from "@/domain/format";
import { kindMeta } from "@/domain/meta";
import { axisTicks, buildRows, parentIds } from "@/domain/waterfall";

const props = defineProps<{ roots: SpanNodeDto[]; totalMs: number; selectedId: string | null }>();
defineEmits<{ select: [spanId: string] }>();

const INDENT = 16;
const collapsed = ref<Set<string>>(new Set());
// una traza nueva empieza expandida
watch(() => props.roots, () => (collapsed.value = new Set()));

const rows = computed(() => buildRows(props.roots, props.totalMs, collapsed.value));
const ticks = computed(() => axisTicks(props.totalMs, 4));
const toggle = (spanId: string) => {
  const next = new Set(collapsed.value);
  if (!next.delete(spanId)) next.add(spanId);
  collapsed.value = next;
};
const kindsPresent = computed(() => [...new Set(rows.value.map((r) => r.node.kind))]);
defineExpose({ collapseAll: () => (collapsed.value = new Set(parentIds(props.roots))), expandAll: () => (collapsed.value = new Set()) });
</script>

<template>
  <div class="tree">
    <div class="axis" aria-hidden="true">
      <span class="axis-edge start">0</span>
      <div class="axis-track">
        <span v-for="t in ticks" :key="t.pct" class="axis-tick" :style="{ left: `${t.pct}%` }">
          <span class="axis-label">{{ formatDuration(t.ms) }}</span>
        </span>
      </div>
      <span class="axis-edge end">{{ formatDuration(props.totalMs) }}</span>
    </div>
    <div class="rows" role="tree" aria-label="Árbol de spans">
      <button
        v-for="r in rows"
        :key="r.node.spanId"
        type="button"
        class="row"
        :class="{ selected: r.node.spanId === selectedId }"
        role="treeitem"
        :aria-selected="r.node.spanId === selectedId"
        :aria-level="r.depth + 1"
        :aria-expanded="r.hasChildren ? !r.collapsed : undefined"
        @click="$emit('select', r.node.spanId)"
      >
        <span v-for="d in r.depth" :key="d" class="guide" :style="{ left: `${12 + (d - 1) * INDENT + 6}px` }" />
        <span class="name-cell" :style="{ paddingLeft: `${r.depth * INDENT}px` }">
          <span class="caret" :class="{ hidden: !r.hasChildren }" @click.stop="toggle(r.node.spanId)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#56655c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path :d="r.collapsed ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'" />
            </svg>
          </span>
          <span class="dot" :style="{ background: r.node.status.code === 'error' ? '#4a7c59' : kindMeta(r.node.kind).color }" />
          <span class="name mono" :class="{ err: r.node.status.code === 'error' }" :title="r.node.name">{{ r.node.name }}</span>
        </span>
        <span class="track" :title="`${formatDuration(r.node.offsetMs)} → ${formatDuration(r.node.offsetMs + r.node.durationMs)}`">
          <span v-for="t in ticks" :key="t.pct" class="grid" :style="{ left: `${t.pct}%` }" />
          <span class="bar" :style="{ left: `${r.leftPct}%`, width: `${r.widthPct}%`, background: r.node.status.code === 'error' ? '#4a7c59' : kindMeta(r.node.kind).color }" />
        </span>
        <span class="dur mono" :class="{ err: r.node.status.code === 'error' }">{{ formatDuration(r.node.durationMs) }}</span>
      </button>
    </div>
    <div class="legend">
      <span v-for="k in kindsPresent" :key="k"><span class="sw" :style="{ background: kindMeta(k).color }" />{{ kindMeta(k).label }}</span>
      <span><span class="sw" style="background: #4a7c59" />Error</span>
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.axis {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) 42px;
  gap: 8px;
  align-items: end;
  padding: 2px 12px 8px;
  color: var(--mt-muted);
  font-family: var(--mt-mono);
  font-size: 10.5px;
  line-height: 1;
}
.axis-edge {
  white-space: nowrap;
}
.axis-edge.end {
  text-align: right;
}
.axis-track {
  position: relative;
  height: 18px;
  border-bottom: 1px solid var(--mt-line-2);
}
.axis-tick {
  position: absolute;
  top: 0;
  bottom: -1px;
  width: 1px;
  background: var(--mt-line-2);
}
.axis-label {
  position: absolute;
  left: 0;
  top: -1px;
  transform: translate(-50%, -100%);
  white-space: nowrap;
}
.axis-tick:first-child .axis-label {
  transform: translate(0, -100%);
}
.axis-tick:last-child .axis-label {
  transform: translate(-100%, -100%);
}
.rows {
  overflow-y: auto;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 68px 56px;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
  height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: var(--mt-ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.row:hover {
  background: var(--mt-soft-2);
}
.row.selected {
  background: #f5f2ff;
  box-shadow: inset 0 0 0 1px #d9d0ff;
}
.guide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #d5ded8;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.caret {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  display: flex;
}
.caret.hidden {
  visibility: hidden;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 4px;
  flex-shrink: 0;
}
.name {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name.err,
.dur.err {
  color: var(--mt-err-ink);
}
.track {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: var(--mt-line-2);
  overflow: hidden;
}
.grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: color-mix(in srgb, var(--mt-line) 80%, transparent);
}
.bar {
  position: absolute;
  top: 0;
  height: 8px;
  border-radius: 4px;
}
.dur {
  text-align: right;
  font-size: 11.5px;
  color: var(--mt-muted);
  white-space: nowrap;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 8px;
  padding: 12px 8px 0;
  border-top: 1px solid var(--mt-line-2);
  color: var(--mt-muted);
  font-size: 11.5px;
}
.legend > span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.sw {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
</style>
