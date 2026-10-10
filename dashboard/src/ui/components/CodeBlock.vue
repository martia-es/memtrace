<script setup lang="ts">
import { computed } from "vue";
import { highlight, type CodeLang } from "@/domain/code-highlight";

/** Bloque de código con colores. Los colores son los tokens `--mt-code-*` (claro y oscuro, en `app.css`). */
const props = defineProps<{ code: string; lang: CodeLang }>();
const lines = computed(() => highlight(props.code, props.lang));
</script>

<template>
  <pre class="code-block" :data-lang="lang"><code><template v-for="(line, i) in lines" :key="i"><span v-for="(t, j) in line" :key="j" :class="`tok-${t.kind}`">{{ t.text }}</span>{{ i < lines.length - 1 ? "\n" : "" }}</template></code></pre>
</template>

<style scoped>
.code-block { margin: 0; font-family: var(--mt-mono); font-size: 12px; line-height: 1.6; color: var(--mt-code-plain); white-space: pre; overflow: auto; }
.code-block code { font: inherit; background: none; padding: 0; }
.tok-keyword { color: var(--mt-code-keyword); font-weight: 500; }
.tok-builtin { color: var(--mt-code-builtin); }
.tok-string { color: var(--mt-code-string); }
.tok-comment { color: var(--mt-code-comment); font-style: italic; }
.tok-number { color: var(--mt-code-number); }
.tok-name { color: var(--mt-code-name); font-weight: 600; }
.tok-key { color: var(--mt-code-key); font-weight: 500; }
</style>
