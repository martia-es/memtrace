<script setup lang="ts">
import { ref } from "vue";
import type { StructuredRow } from "@/domain/structured-view";
import Button from "./Button.vue";

/**
 * A tool's arguments or result as a table instead of braces. A list of objects becomes a small table that shows its
 * first rows; the raw JSON stays in the panel's JSON view.
 */
defineProps<{ rows: StructuredRow[] }>();

const PREVIEW_ROWS = 5;
const expanded = ref<Set<string>>(new Set());
const toggle = (key: string) => {
  const next = new Set(expanded.value);
  if (!next.delete(key)) next.add(key);
  expanded.value = next;
};
</script>

<template>
  <div class="structured" data-testid="structured-data">
    <template v-for="r in rows" :key="r.key">
      <div v-if="r.kind === 'field'" class="field"><span class="k" :title="r.key">{{ r.key }}</span><span class="val">{{ r.value }}</span></div>
      <div v-else class="table-wrap">
        <span class="k">{{ r.key }} <span class="n">{{ r.total }}</span></span>
        <div class="scroll">
          <table>
            <thead><tr><th v-for="c in r.columns" :key="c">{{ c }}</th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in expanded.has(r.key) ? r.rows : r.rows.slice(0, PREVIEW_ROWS)" :key="i"><td v-for="(cell, j) in row" :key="j">{{ cell }}</td></tr>
            </tbody>
          </table>
        </div>
        <Button v-if="r.rows.length > PREVIEW_ROWS" variant="link" @click="toggle(r.key)">{{ expanded.has(r.key) ? "Show fewer" : `Show ${r.rows.length - PREVIEW_ROWS} more` }}</Button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.structured {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mt-line-2);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft-2);
  padding: 2px 12px;
  font-size: 12px;
}
.field {
  display: grid;
  grid-template-columns: minmax(120px, 200px) minmax(0, 1fr);
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--mt-line-2);
}
.field:last-child {
  border-bottom: 0;
}
.k {
  color: var(--mt-muted);
  font-family: var(--mt-mono);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.val {
  font-family: var(--mt-mono);
  overflow-wrap: anywhere;
}
.n {
  margin-left: 4px;
  padding: 0 5px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-line);
}
.table-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mt-line-2);
}
.table-wrap:last-child {
  border-bottom: 0;
}
.scroll {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--mt-mono);
  font-size: 11.5px;
}
th,
td {
  padding: 4px 10px 4px 0;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--mt-line-2);
}
th {
  color: var(--mt-muted);
  font-weight: 600;
}
</style>
