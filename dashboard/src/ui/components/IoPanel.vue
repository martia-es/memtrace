<script setup lang="ts">
import { computed, ref } from "vue";
import type { IoBlock } from "@/domain/span-io";
import { structuredRows } from "@/domain/structured-view";
import MessageBlock from "./MessageBlock.vue";
import StructuredData from "./StructuredData.vue";
import SegmentedControl from "./SegmentedControl.vue";
import Pill from "./Pill.vue";
import Button from "./Button.vue";
import { t } from "../i18n";

const props = defineProps<{
  title: string;
  badge: string;
  badgeTone?: "neutral" | "error";
  blocks: IoBlock[];
  json: string;
  /** hint text shown when there is no stored content */
  emptyHint: string;
}>();

// tool arguments and results (JSON objects) read as a table; chat messages keep their own rendering
const tableOf = (b: IoBlock) => (b.structured && (b.role === "other" || b.role === "tool") ? structuredRows(b.text) : null);
const mode = ref<"text" | "json">("text");
const MODE_OPTIONS = [{ value: "text", get label() { return t("ioPanel.text"); } }, { value: "json", label: "JSON" }];
const collapsed = ref(false);
const copied = ref(false);
const copyText = computed(() => (mode.value === "json" ? props.json : props.blocks.map((b) => b.text).join("\n\n")));

async function copy() {
  try {
    await navigator.clipboard.writeText(copyText.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <section class="panel" :class="{ collapsed }" :aria-label="title">
    <div class="head">
      <Button variant="icon" size="sm" class="collapse-btn" :aria-expanded="!collapsed" :aria-label="collapsed ? t('ioPanel.expand_title', { title: title.toLowerCase() }) : t('ioPanel.collapse_title', { title: title.toLowerCase() })" @click="collapsed = !collapsed">
        <q-icon name="chevron_right" size="16px" :class="{ open: !collapsed }" />
      </Button>
      <h2>{{ title }}</h2>
      <Pill :tone="badgeTone === 'error' ? 'error' : 'neutral'">{{ badge }}</Pill>
      <template v-if="!collapsed">
        <SegmentedControl class="toggle" size="sm" :aria-label="t('ioPanel.title_format', { title })" :options="MODE_OPTIONS" :model-value="mode" @update:model-value="mode = $event as 'text' | 'json'" />
        <Button variant="icon" size="sm" class="mt-round-btn copy" :aria-label="t('ioPanel.copy_title', { title: title.toLowerCase() })" :disabled="blocks.length === 0" @click="copy">
          <q-icon :name="copied ? 'check' : 'content_copy'" size="14px" />
        </Button>
      </template>
    </div>
    <div v-if="!collapsed" class="body">
      <p v-if="blocks.length === 0" class="empty">{{ emptyHint }}</p>
      <pre v-else-if="mode === 'json'" class="block mono json">{{ json }}</pre>
      <template v-else>
        <template v-for="(b, i) in blocks" :key="i">
          <StructuredData v-if="tableOf(b)" :rows="tableOf(b)!" />
          <MessageBlock v-else :block="b" />
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* Sección plana (no mt-card): vive dentro del borde único del inspector, sin su propia
   sombra/tarjeta para que el lateral se lea como un solo bloque sólido. */
.panel {
  box-sizing: border-box;
  padding: 14px 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  border-bottom: 1px solid var(--mt-line);
}
.panel.collapsed {
  padding: 8px 4px;
  gap: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 6px;
}
.collapse-btn { flex-shrink: 0; }

.collapse-btn .q-icon {
  transition: transform 0.12s ease;
}
.collapse-btn .q-icon.open {
  transform: rotate(90deg);
}
h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.toggle {
  margin-left: auto;
}

/* Sin scroll propio: el lateral entero (SpanInspector .body) es el único contenedor con scroll,
   así ver el input completo no depende de encontrar la caja correcta bajo el ratón. */
.body {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-right: 8px;
}
.json {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--mt-radius-sm);
  background: var(--mt-soft-2);
  border: 1px solid var(--mt-line-2);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.empty {
  margin: 0;
  color: var(--mt-muted);
  line-height: 1.5;
}
</style>
