<script setup lang="ts">
import { computed, ref } from "vue";
import type { IoBlock } from "@/domain/span-io";
import MessageBlock from "./MessageBlock.vue";

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
const collapsed = ref(false);
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
</script>

<template>
  <section class="panel" :class="{ collapsed }" :aria-label="title">
    <div class="head">
      <button type="button" class="collapse-btn" :aria-expanded="!collapsed" :aria-label="collapsed ? `Expandir ${title.toLowerCase()}` : `Colapsar ${title.toLowerCase()}`" @click="collapsed = !collapsed">
        <q-icon name="chevron_right" size="16px" :class="{ open: !collapsed }" />
      </button>
      <h2>{{ title }}</h2>
      <span class="badge" :class="{ error: badgeTone === 'error' }">{{ badge }}</span>
      <template v-if="!collapsed">
        <div class="mt-segmented small toggle" role="group" :aria-label="`Formato de ${title.toLowerCase()}`">
          <button type="button" :aria-pressed="mode === 'text'" @click="mode = 'text'">Texto</button>
          <button type="button" :aria-pressed="mode === 'json'" @click="mode = 'json'">JSON</button>
        </div>
        <button type="button" class="mt-round-btn copy" :aria-label="`Copiar ${title.toLowerCase()}`" :disabled="blocks.length === 0" @click="copy">
          <q-icon :name="copied ? 'check' : 'content_copy'" size="14px" />
        </button>
      </template>
    </div>
    <div v-if="!collapsed" class="body">
      <p v-if="blocks.length === 0" class="empty">{{ emptyHint }}</p>
      <pre v-else-if="mode === 'json'" class="block mono json">{{ json }}</pre>
      <template v-else>
        <MessageBlock v-for="(b, i) in blocks" :key="i" :block="b" />
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
.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mt-muted);
  cursor: pointer;
}
.collapse-btn:hover {
  background: var(--mt-soft-2);
}
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
  border-radius: 8px;
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
