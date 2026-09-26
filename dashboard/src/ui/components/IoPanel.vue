<script setup lang="ts">
import { computed, ref } from "vue";
import type { IoBlock } from "@/domain/span-io";

const props = defineProps<{
  title: string;
  badge: string;
  badgeTone?: "neutral" | "error";
  blocks: IoBlock[];
  json: string;
  /** texto de ayuda cuando no hay contenido guardado */
  emptyHint: string;
}>();

const mode = ref<"text" | "json">("text");
const copied = ref(false);
const copyText = computed(() => (mode.value === "json" ? props.json : props.blocks.map((b) => b.text).join("\n\n")));

async function copy() {
  try {
    await navigator.clipboard.writeText(copyText.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* portapapeles no disponible */
  }
}
const tint = (b: IoBlock) => ({ user: "#f4f8f5", assistant: "#ede8ff", system: "#f6f4ee", tool: "#ffe9d9", error: "#ffe1de", other: "#f4f8f5" })[b.role];
const labelColor = (b: IoBlock) => ({ user: "#56655c", assistant: "#4a32c9", system: "#8a6d3b", tool: "#b24a0a", error: "#b3261e", other: "#56655c" })[b.role];
</script>

<template>
  <section class="mt-card panel" :aria-label="title">
    <div class="head">
      <h2>{{ title }}</h2>
      <span class="badge" :class="{ error: badgeTone === 'error' }">{{ badge }}</span>
      <div class="mt-segmented small toggle" role="group" :aria-label="`Formato de ${title.toLowerCase()}`">
        <button type="button" :aria-pressed="mode === 'text'" @click="mode = 'text'">Texto</button>
        <button type="button" :aria-pressed="mode === 'json'" @click="mode = 'json'">JSON</button>
      </div>
      <button type="button" class="mt-round-btn copy" :aria-label="`Copiar ${title.toLowerCase()}`" :disabled="blocks.length === 0" @click="copy">
        <q-icon :name="copied ? 'check' : 'content_copy'" size="14px" />
      </button>
    </div>
    <div class="body">
      <p v-if="blocks.length === 0" class="empty">{{ emptyHint }}</p>
      <pre v-else-if="mode === 'json'" class="block mono json">{{ json }}</pre>
      <template v-else>
        <div v-for="(b, i) in blocks" :key="i" class="item">
          <span class="label" :style="{ color: labelColor(b) }">{{ b.label }}</span>
          <div class="block" :class="{ mono: b.structured }" :style="{ background: tint(b) }">{{ b.text }}</div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.panel {
  box-sizing: border-box;
  padding: 16px 12px 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 6px;
}
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.badge {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--mt-soft);
  color: var(--mt-muted);
  font-size: 12px;
  white-space: nowrap;
}
.badge.error {
  background: var(--mt-err-bg);
  color: var(--mt-err-ink);
}
.toggle {
  margin-left: auto;
}
.copy {
  width: 28px;
  height: 28px;
}
.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 8px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex-shrink: 0;
}
.label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.block {
  border-radius: 16px;
  padding: 10px 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  color: #22302a;
}
.block.mono {
  font-size: 12px;
}
.json {
  margin: 0;
  background: var(--mt-soft-2);
}
.empty {
  margin: 0;
  color: var(--mt-muted);
  line-height: 1.5;
}
</style>
