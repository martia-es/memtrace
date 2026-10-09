<script setup lang="ts">
import { computed } from "vue";
import { sideBySideDiff, type DiffCell } from "@/domain/text-diff";

/** Diferencia de texto entre dos versiones de un prompt, en dos columnas con números de línea (rojo = quitado, verde = añadido). */
const props = defineProps<{ oldText: string; newText: string; oldLabel: string; newLabel: string }>();

const rows = computed(() => sideBySideDiff(props.oldText, props.newText));
const identical = computed(() => rows.value.every((r) => r.left.kind === "same"));

/** Cada celda con su número de línea en su propio texto (las celdas vacías de relleno no numeran). */
const numbered = computed(() => {
  let l = 0;
  let r = 0;
  const num = (cell: DiffCell, n: number) => (cell.kind === "empty" ? null : n);
  return rows.value.map((row) => {
    if (row.left.kind !== "empty") l += 1;
    if (row.right.kind !== "empty") r += 1;
    return { left: row.left, right: row.right, ln: num(row.left, l), rn: num(row.right, r) };
  });
});

const summary = computed(() => {
  let rewritten = 0;
  let added = 0;
  let removed = 0;
  for (const { left, right } of rows.value) {
    if (left.kind === "del" && right.kind === "add") rewritten += 1;
    else if (right.kind === "add") added += 1;
    else if (left.kind === "del") removed += 1;
  }
  return [rewritten && `${rewritten} ${rewritten === 1 ? "line" : "lines"} rewritten`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(", ");
});
const mark = (kind: DiffCell["kind"]) => (kind === "add" ? "+" : kind === "del" ? "−" : "");
</script>

<template>
  <p v-if="identical" class="muted" data-testid="prompt-diff-empty">No differences between {{ oldLabel }} and {{ newLabel }}.</p>
  <section v-else class="card" data-testid="prompt-diff-card">
    <header class="head"><strong>Prompt changes</strong><span class="summary">{{ summary }}</span></header>
    <div class="diff" data-testid="prompt-diff">
      <div class="side-title">{{ oldLabel }} · base</div>
      <div class="side-title">{{ newLabel }} · selected</div>
      <template v-for="(row, i) in numbered" :key="i">
        <div class="cell" :class="row.left.kind"><span class="no">{{ row.ln }}</span><span class="mark">{{ mark(row.left.kind) }}</span><pre class="line">{{ row.left.text }}</pre></div>
        <div class="cell" :class="row.right.kind"><span class="no">{{ row.rn }}</span><span class="mark">{{ mark(row.right.kind) }}</span><pre class="line">{{ row.right.text }}</pre></div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.muted {
  color: var(--mt-muted);
  font-size: 13px;
}
.card {
  border: 1px solid var(--mt-line);
  border-radius: 10px;
  background: var(--mt-card);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--mt-line);
  font-size: 13px;
}
.summary {
  color: var(--mt-muted);
  font-size: 12.5px;
}
.diff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  overflow-x: auto;
}
.side-title {
  padding: 6px 16px;
  background: var(--mt-soft-2);
  border-bottom: 1px solid var(--mt-line);
  font-family: var(--mt-mono, "JetBrains Mono", monospace);
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mt-muted);
}
.side-title + .side-title,
.cell:nth-child(even) {
  border-left: 1px solid var(--mt-line);
}
.cell {
  display: flex;
  align-items: baseline;
  min-height: 28px;
  padding: 3px 0;
}
.no {
  flex: none;
  width: 34px;
  padding-right: 8px;
  text-align: right;
  font-family: var(--mt-mono, "JetBrains Mono", monospace);
  font-size: 11.5px;
  color: var(--mt-faint);
}
.mark {
  flex: none;
  width: 16px;
  font-family: var(--mt-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  font-weight: 700;
}
.line {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding-right: 12px;
  font-family: var(--mt-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.cell.del {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.cell.add {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.cell.empty {
  background: var(--mt-soft-2);
}
</style>
