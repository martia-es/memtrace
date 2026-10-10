<script setup lang="ts">
import { computed } from "vue";
import type { AssistantDisplayMode } from "@/domain/assistant-display";
import AssistantChat from "./AssistantChat.vue";
import AssistantModeSwitch from "./AssistantModeSwitch.vue";
import { useAssistantDisplay } from "../composables/useAssistantDisplay";
import { useChatDock } from "../composables/useChatDock";
import Button from "./Button.vue";

/**
 * Contenedor del chat con un agente (ADR-055) en dos de los tres modos de visualización (ADR-063):
 * burbuja flotante abajo a la derecha, o panel lateral que empuja el contenido. La pantalla completa
 * vive en otra pestaña (AssistantFullscreenPage) y aquí solo se pide abrirla.
 */
const dock = useChatDock();
const { state } = dock;
const display = useAssistantDisplay(() => state.target?.experimentId ?? null);
const displayName = computed(() => (state.target ? display.nameFor(state.target.agentName) : ""));
const asPanel = computed(() => display.mode.value === "dock");

function onModeSelected(mode: AssistantDisplayMode) {
  // burbuja ↔ panel se resuelve solo (el modo ya es reactivo); pantalla completa se lleva la conversación a otra pestaña
  if (mode === "fullscreen" && state.target) dock.openFullscreen(state.target);
}
</script>

<template>
  <div v-if="state.target && !asPanel && state.maximized && !state.minimized" class="backdrop" @click="state.maximized = false" />
  <aside
    v-if="state.target"
    class="dock"
    :class="{ panel: asPanel, min: !asPanel && state.minimized, max: !asPanel && state.maximized && !state.minimized }"
    role="dialog"
    :aria-label="`Chat with ${displayName}`"
    data-testid="chat-dock"
    @keydown.esc="state.maximized = false"
  >
    <header class="bar">
      <button type="button" class="title" :aria-expanded="asPanel || !state.minimized" @click="!asPanel && (state.minimized = !state.minimized)">
        <span class="dot" aria-hidden="true" />
        <b>{{ displayName }}</b>
        <span class="env">{{ state.target.environmentLabel }}</span>
      </button>
      <AssistantModeSwitch v-if="!state.minimized" :theme="display.theme.value" :current="display.mode.value" @select="onModeSelected" />
      <Button variant="icon" size="sm" v-if="!state.minimized && state.messages.length > 0" class="icon" title="New conversation" aria-label="New conversation" @click="dock.reset()">↺</Button>
      <Button variant="icon" size="sm" v-if="!asPanel && !state.minimized" class="icon" :title="state.maximized ? 'Restore size' : 'Maximize'" :aria-label="state.maximized ? 'Restore size' : 'Maximize'" data-testid="chat-maximize" @click="state.maximized = !state.maximized">{{ state.maximized ? "⤡" : "⤢" }}</Button>
      <Button variant="icon" size="sm" v-if="!asPanel" class="icon" :title="state.minimized ? 'Expand' : 'Minimize'" :aria-label="state.minimized ? 'Expand' : 'Minimize'" @click="state.minimized = !state.minimized">{{ state.minimized ? "▢" : "–" }}</Button>
      <Button variant="icon" size="sm" class="icon" title="Close" aria-label="Close chat" data-testid="chat-close" @click="dock.close()">✕</Button>
    </header>
    <AssistantChat v-if="asPanel || !state.minimized" :display-name="displayName" :large="!asPanel && state.maximized" />
  </aside>
</template>

<style scoped>
.dock { position: fixed; right: 20px; bottom: 20px; z-index: 50; display: flex; flex-direction: column; width: 440px; max-width: calc(100vw - 24px); height: 640px; max-height: calc(100vh - 40px); font-family: var(--mt-sans); background: var(--mt-card); border: 1px solid var(--mt-line); border-radius: var(--mt-radius-lg); box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18); overflow: hidden; }
.dock.min { height: auto; width: 300px; }
.dock.max { inset: 4vh 4vw; width: auto; height: auto; max-width: none; max-height: none; z-index: 61; }
/* panel lateral: es un hijo más del flex de .shell, así que empuja el contenido en vez de taparlo */
.dock.panel { position: static; flex: none; width: 400px; max-width: 45vw; height: 100%; max-height: none; border-width: 0 0 0 1px; border-radius: 0; box-shadow: none; }
.backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.45); }
.bar { display: flex; align-items: center; gap: 2px; padding: 6px 6px 6px 12px; background: color-mix(in srgb, var(--mt-accent) 7%, var(--mt-card)); border-bottom: 1px solid var(--mt-line); }
.dock.min .bar { border-bottom: none; }
.title { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; padding: 4px 0; font: inherit; font-size: 13px; color: var(--mt-ink); background: none; border: none; cursor: pointer; text-align: left; }
.dock.panel .title { cursor: default; }
.title b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--mt-accent); }
.env { flex: none; font-family: var(--mt-mono); font-size: 11px; color: var(--mt-muted); }


.title:focus-visible, .icon:focus-visible { outline: 2px solid var(--mt-accent); outline-offset: 2px; }
@media (max-width: 480px) { .dock:not(.panel) { right: 12px; bottom: 12px; } }
</style>
