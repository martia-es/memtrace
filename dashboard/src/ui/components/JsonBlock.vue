<script setup lang="ts">
import { computed } from "vue";
import { useQuasar } from "quasar";

const props = defineProps<{ value: unknown }>();
const $q = useQuasar();

const text = computed(() => (typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2)));

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value);
    $q.notify({ message: "Copiado", timeout: 1200, position: "bottom" });
  } catch {
    $q.notify({ message: "Could not copy", color: "negative", timeout: 1500 });
  }
}
</script>

<template>
  <div class="json-block">
    <q-btn flat round dense size="sm" icon="content_copy" class="copy" aria-label="Copy" @click="copy" />
    <pre>{{ text }}</pre>
  </div>
</template>

<style scoped>
.json-block {
  position: relative;
  border: 1px solid var(--wf-line);
  border-radius: var(--mt-radius-sm);
  background: var(--code-bg);
}
.copy {
  position: absolute;
  top: 4px;
  right: 4px;
}
pre {
  margin: 0;
  padding: 10px 36px 10px 12px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow: auto;
}
</style>
