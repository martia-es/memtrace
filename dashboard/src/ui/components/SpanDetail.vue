<script setup lang="ts">
import type { SpanNodeDto } from "@contract";
import { computed, ref, watch } from "vue";
import { formatDateTime, formatDuration } from "@/domain/format";
import { kindMeta, statusMeta } from "@/domain/meta";
import { genAiRows as genAiRowsOf } from "@/domain/span-io";
import JsonBlock from "./JsonBlock.vue";
import MessageList from "./MessageList.vue";

const props = defineProps<{ node: SpanNodeDto }>();

const tab = ref("summary");
const available = computed(() => ({
  genai: props.node.genAi !== null,
  content: props.node.content !== null,
  events: props.node.events.length > 0,
  attributes: Object.keys(props.node.attributes).length > 0,
}));
// Al cambiar de span, si la pestaña ya no existe se vuelve al resumen
watch(
  () => props.node.spanId,
  () => {
    if (tab.value !== "summary" && !available.value[tab.value as keyof typeof available.value]) tab.value = "summary";
  },
);

const genAiRows = computed(() => genAiRowsOf(props.node));

const contentSections = computed(() => {
  const c = props.node.content;
  if (!c) return [];
  return [
    { key: "inputMessages", title: "Mensajes de entrada", value: c.inputMessages, messages: true },
    { key: "outputMessages", title: "Mensajes de salida", value: c.outputMessages, messages: true },
    { key: "toolArguments", title: "Argumentos de la herramienta", value: c.toolArguments },
    { key: "toolResult", title: "Resultado de la herramienta", value: c.toolResult },
    { key: "input", title: "Entrada", value: c.input },
    { key: "output", title: "Salida", value: c.output },
  ].filter((s) => s.value !== undefined);
});
</script>

<template>
  <div class="span-detail">
    <div class="row items-center q-gutter-x-sm">
      <q-icon :name="kindMeta(node.kind).icon" :style="{ color: kindMeta(node.kind).color }" size="22px" />
      <div class="text-subtitle1 text-weight-medium ellipsis" :title="node.name">{{ node.name }}</div>
    </div>
    <div class="q-mt-xs q-gutter-x-xs">
      <q-chip dense square :label="kindMeta(node.kind).label" />
      <q-chip dense square :color="statusMeta(node.status.code).color" text-color="white" :icon="statusMeta(node.status.code).icon" :label="statusMeta(node.status.code).label" />
    </div>

    <q-tabs v-model="tab" dense no-caps align="left" class="q-mt-sm" active-color="primary" indicator-color="primary" inline-label>
      <q-tab name="summary" label="Resumen" />
      <q-tab v-if="available.genai" name="genai" label="GenAI" />
      <q-tab v-if="available.content" name="content" label="Contenido" />
      <q-tab v-if="available.events" name="events" :label="`Eventos (${node.events.length})`" />
      <q-tab v-if="available.attributes" name="attributes" label="Atributos" />
    </q-tabs>
    <q-separator />

    <q-tab-panels v-model="tab" animated class="bg-transparent">
      <q-tab-panel name="summary" class="q-pa-sm">
        <q-list dense>
          <q-item><q-item-section>Duración</q-item-section><q-item-section side>{{ formatDuration(node.durationMs) }}</q-item-section></q-item>
          <q-item><q-item-section>Inicio</q-item-section><q-item-section side>{{ formatDateTime(node.startTime) }}</q-item-section></q-item>
          <q-item><q-item-section>Desfase</q-item-section><q-item-section side>+{{ formatDuration(node.offsetMs) }}</q-item-section></q-item>
          <q-item><q-item-section>Servicio</q-item-section><q-item-section side>{{ node.serviceName }}</q-item-section></q-item>
          <q-item><q-item-section>Span id</q-item-section><q-item-section side class="mono">{{ node.spanId }}</q-item-section></q-item>
        </q-list>
        <q-banner v-if="node.status.code === 'error'" rounded dense class="bg-negative text-white q-mt-sm">
          {{ node.status.message || "El span terminó con error" }}
        </q-banner>
        <q-banner v-if="node.orphan" rounded dense class="bg-warning text-black q-mt-sm">
          Su padre no está en la traza: se muestra como raíz.
        </q-banner>
      </q-tab-panel>

      <q-tab-panel name="genai" class="q-pa-sm">
        <q-list dense separator>
          <q-item v-for="[label, value] in genAiRows" :key="label">
            <q-item-section>{{ label }}</q-item-section>
            <q-item-section side class="text-body2">{{ value }}</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="content" class="q-pa-sm">
        <div v-for="s in contentSections" :key="s.key" class="q-mb-md">
          <div class="text-caption text-grey-7 q-mb-xs">{{ s.title }}</div>
          <MessageList v-if="s.messages" :messages="s.value" />
          <JsonBlock v-else :value="s.value" />
        </div>
      </q-tab-panel>

      <q-tab-panel name="events" class="q-pa-sm">
        <div v-for="(e, i) in node.events" :key="i" class="q-mb-md">
          <div class="row items-center q-gutter-x-sm">
            <q-icon :name="e.name === 'exception' ? 'bug_report' : 'bolt'" :color="e.name === 'exception' ? 'negative' : 'grey-7'" />
            <span class="text-weight-medium">{{ e.name }}</span>
            <span class="text-caption text-grey-7">{{ formatDateTime(e.time) }}</span>
          </div>
          <JsonBlock class="q-mt-xs" :value="e.attributes" />
        </div>
      </q-tab-panel>

      <q-tab-panel name="attributes" class="q-pa-sm">
        <q-list dense separator>
          <q-item v-for="(value, key) in node.attributes" :key="key">
            <q-item-section class="mono text-caption">{{ key }}</q-item-section>
            <q-item-section side class="text-body2 attr-value">{{ value }}</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<style scoped>
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.attr-value {
  max-width: 55%;
  word-break: break-word;
  text-align: right;
}
</style>
