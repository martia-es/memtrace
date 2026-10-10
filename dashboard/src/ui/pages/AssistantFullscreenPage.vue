<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { parseFullscreenQuery } from "@/domain/assistant-display";
import AssistantChat from "../components/AssistantChat.vue";
import { setKnownThemes, useAssistantDisplay } from "../composables/useAssistantDisplay";
import { useChatDock } from "../composables/useChatDock";
import { useIdentityApi } from "../composables/useIdentityApi";
import { applyOrganizationTheme } from "../composables/useOrganizationTheme";
import Button from "../components/Button.vue";

/** Chat a pantalla completa, en su propia pestaña (ADR-063). Ruta sin sidebar: hereda sesión y tema de la organización. */
const route = useRoute();
const dock = useChatDock();
const identityApi = useIdentityApi();
const target = computed(() => parseFullscreenQuery(route.query));
const display = useAssistantDisplay(() => target.value?.experimentId ?? null);
const displayName = computed(() => (target.value ? display.nameFor(target.value.agentName) : ""));

onMounted(async () => {
  if (!target.value) return;
  dock.show(target.value);
  dock.takeHandoff(target.value);
  // la pestaña es nueva: hay que cargar el tema de la organización aquí también
  const experiments = await identityApi.listExperiments();
  setKnownThemes(experiments);
  applyOrganizationTheme(experiments.find((e) => e.id === target.value!.experimentId)?.organizationTheme ?? null);
});
</script>

<template>
  <div class="page">
    <p v-if="!target" class="missing">Open the assistant from its card in Assistants.</p>
    <template v-else>
      <header class="bar">
        <span class="dot" aria-hidden="true" />
        <b>{{ displayName }}</b>
        <span class="env">{{ target.environmentLabel }}</span>
        <span class="grow" />
        <Button @click="dock.reset()">New conversation</Button>
      </header>
      <AssistantChat :display-name="displayName" large />
    </template>
  </div>
</template>

<style scoped>
.page { display: flex; flex-direction: column; height: 100vh; font-family: var(--mt-sans); color: var(--mt-ink); background: var(--mt-bg); }
.bar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: color-mix(in srgb, var(--mt-accent) 7%, var(--mt-card)); border-bottom: 1px solid var(--mt-line); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--mt-accent); }
.env { font-family: var(--mt-mono); font-size: 11px; color: var(--mt-muted); }
.grow { flex: 1; }
.missing { margin: auto; color: var(--mt-muted); }
</style>
