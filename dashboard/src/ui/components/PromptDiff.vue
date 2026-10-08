<script setup lang="ts">
import { computed } from "vue";
import { sideBySideDiff } from "@/domain/text-diff";

/** Diferencia de texto entre dos versiones de un prompt, en dos columnas (rojo = quitado, verde = añadido). */
const props = defineProps<{ oldText: string; newText: string; oldLabel: string; newLabel: string }>();

const rows = computed(() => sideBySideDiff(props.oldText, props.newText));
const identical = computed(() => rows.value.every((r) => r.left.kind === "same"));
</script>

<template>
  <p v-if="identical" class="muted" data-testid="prompt-diff-empty">No differences between {{ oldLabel }} and {{ newLabel }}.</p>
  <div v-else class="diff" data-testid="prompt-diff">
    <div class="side-title">{{ oldLabel }}</div>
    <div class="side-title">{{ newLabel }}</div>
    <template v-for="(row, i) in rows" :key="i">
      <pre class="line" :class="row.left.kind">{{ row.left.text }}</pre>
      <pre class="line" :class="row.right.kind">{{ row.right.text }}</pre>
    </template>
  </div>
</template>

<style scoped>
.muted {
  color: var(--mt-muted);
  font-size: 13px;
}
.diff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  border: 1px solid var(--mt-line);
}
.side-title {
  padding: 4px 10px;
  background: var(--mt-soft-2);
  border-bottom: 1px solid var(--mt-line);
  font-size: 11px;
  font-weight: 600;
  color: var(--mt-muted);
}
.line {
  margin: 0;
  padding: 1px 10px;
  min-height: 1.5em;
  font-family: var(--mt-mono, "JetBrains Mono", monospace);
  font-size: 12.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.line.del {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.line.add {
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
}
.line.empty {
  background: var(--mt-soft-2);
}
</style>
