<script setup lang="ts">
import type { SpanNodeDto } from "@contract";
import { computed } from "vue";
import { formatDuration } from "@/domain/format";
import { kindMeta } from "@/domain/meta";
import { axisTicks, buildRows } from "@/domain/waterfall";

const props = defineProps<{
  roots: SpanNodeDto[];
  totalMs: number;
  selectedId: string | null;
  collapsed: ReadonlySet<string>;
}>();
const emit = defineEmits<{ select: [spanId: string]; toggle: [spanId: string] }>();

const rows = computed(() => buildRows(props.roots, props.totalMs, props.collapsed));
const ticks = computed(() => axisTicks(props.totalMs));

type Row = (typeof rows.value)[number];

/** Barras anchas: etiqueta dentro (a la derecha). Estrechas: al lado, hacia donde haya sitio. */
function labelStyle(row: Row): Record<string, string> {
  const end = row.leftPct + row.widthPct;
  if (row.widthPct >= 22) return { right: `${100 - end + 0.6}%` };
  return end > 78 ? { right: `${100 - row.leftPct + 0.5}%` } : { left: `${end + 0.5}%` };
}

function barColor(row: Row): string {
  return row.node.status.code === "error" ? "var(--q-negative)" : kindMeta(row.node.kind).color;
}
</script>

<template>
  <div class="wf" role="tree" aria-label="Cascada de spans">
    <div class="wf-row wf-header">
      <div class="wf-name text-caption text-grey-7">Span</div>
      <div class="wf-lane">
        <span v-for="t in ticks" :key="t.pct" class="wf-tick text-caption text-grey-7" :style="{ left: `${t.pct}%` }">
          {{ formatDuration(t.ms) }}
        </span>
      </div>
    </div>

    <div
      v-for="row in rows"
      :key="row.node.spanId"
      class="wf-row"
      :class="{ 'wf-selected': row.node.spanId === selectedId }"
      role="treeitem"
      tabindex="0"
      :aria-selected="row.node.spanId === selectedId"
      :aria-expanded="row.hasChildren ? !row.collapsed : undefined"
      @click="emit('select', row.node.spanId)"
      @keydown.enter.prevent="emit('select', row.node.spanId)"
      @keydown.space.prevent="emit('select', row.node.spanId)"
    >
      <div class="wf-name" :style="{ paddingLeft: `${row.depth * 16 + 4}px` }">
        <q-btn
          v-if="row.hasChildren"
          flat
          round
          dense
          size="sm"
          :icon="row.collapsed ? 'chevron_right' : 'expand_more'"
          :aria-label="row.collapsed ? 'Expandir' : 'Colapsar'"
          @click.stop="emit('toggle', row.node.spanId)"
        />
        <span v-else class="wf-spacer" />
        <q-icon :name="kindMeta(row.node.kind).icon" size="16px" :style="{ color: kindMeta(row.node.kind).color }" />
        <span class="wf-label" :title="row.node.name">{{ row.node.name }}</span>
        <q-icon v-if="row.node.status.code === 'error'" name="error" color="negative" size="16px" aria-label="Con error" />
        <q-icon v-if="row.node.orphan" name="link_off" color="warning" size="16px">
          <q-tooltip>Su padre no está en la traza (perdido o aún no exportado)</q-tooltip>
        </q-icon>
      </div>
      <div class="wf-lane">
        <div
          class="wf-bar"
          :style="{ left: `${row.leftPct}%`, width: `${row.widthPct}%`, background: barColor(row) }"
        />
        <span class="wf-duration text-caption" :class="{ 'wf-duration-inside': row.widthPct >= 22 }" :style="labelStyle(row)">
          {{ formatDuration(row.node.durationMs) }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wf {
  border: 1px solid var(--wf-line);
  border-radius: 6px;
  overflow: hidden;
}
.wf-row {
  display: grid;
  grid-template-columns: minmax(200px, 38%) 1fr;
  min-height: 30px;
  border-bottom: 1px solid var(--wf-line);
  cursor: pointer;
}
.wf-row:last-child {
  border-bottom: none;
}
.wf-row:hover {
  background: var(--wf-hover);
}
.wf-row:focus-visible {
  outline: 2px solid var(--q-primary);
  outline-offset: -2px;
}
.wf-selected {
  background: var(--wf-selected) !important;
}
.wf-header {
  cursor: default;
  min-height: 28px;
  background: var(--wf-hover);
}
.wf-header:hover {
  background: var(--wf-hover);
}
.wf-name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding-right: 8px;
}
.wf-spacer {
  display: inline-block;
  width: 24px;
  flex: none;
}
.wf-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.wf-lane {
  position: relative;
  border-left: 1px solid var(--wf-line);
}
.wf-tick {
  position: absolute;
  top: 5px;
  transform: translateX(-50%);
  white-space: nowrap;
}
.wf-tick:first-child {
  transform: none;
  margin-left: 4px;
}
.wf-tick:last-child {
  transform: translateX(-100%);
  margin-left: -4px;
}
@media (max-width: 700px) {
  /* en pantallas estrechas solo caben las marcas de los extremos */
  .wf-tick:not(:first-child):not(:last-child) {
    display: none;
  }
}
.wf-bar {
  position: absolute;
  top: 8px;
  height: 14px;
  min-width: 2px;
  border-radius: 3px;
  opacity: 0.92;
}
.wf-duration {
  position: absolute;
  top: 6px;
  white-space: nowrap;
  color: var(--q-grey-7, #666);
}
.wf-duration-inside {
  color: #fff;
  font-weight: 500;
  pointer-events: none;
}
</style>
