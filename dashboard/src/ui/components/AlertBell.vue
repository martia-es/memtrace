<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatRelativeTime } from "@/domain/format";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import { formatValue, thresholdPhrase } from "../alert-format";
import Button from "./Button.vue";
import Menu from "./Menu.vue";
import MenuItem from "./MenuItem.vue";

/**
 * La campana de la barra superior (ADR-086): cuántas alertas están disparadas ahora en los agentes que la persona puede leer, y
 * un menú para ir a cada una. Se renueva cada minuto; un fallo de la consulta no molesta, la campana se queda como estaba.
 */
const api = useIdentityApi();
const router = useRouter();
const route = useRoute();
const open = useAsync((signal) => api.listOpenAlerts(signal));
const items = computed(() => open.data.value?.items ?? []);

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void open.run();
  timer = setInterval(() => void open.run(), 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

/** «Manage alerts» abre las del agente que se está mirando, o las del primero que dispara. */
const manageExperimentId = computed(() => (route.params.experimentId as string | undefined) ?? items.value[0]?.experimentId ?? "");

function go(experimentId: string) {
  void router.push({ name: "alerts", params: { experimentId } });
}
const describe = (a: (typeof items.value)[number]) => thresholdPhrase(a);
</script>

<template>
  <div class="bell" data-testid="alert-bell">
    <Button variant="icon" :aria-label="items.length ? `${items.length} alerts firing` : 'Alerts'" @click="open.run()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      <span v-if="items.length" class="badge" data-testid="bell-count">{{ items.length > 9 ? "9+" : items.length }}</span>
      <Menu auto-close anchor="bottom right" self="top right" :offset="[0, 6]" class="bell-menu">
        <div class="head"><span class="head-title">Notifications</span></div>
        <p v-if="items.length === 0" class="none" data-testid="bell-empty">No alerts firing.</p>
        <template v-else>
          <p class="title">Firing now · {{ items.length }}</p>
          <MenuItem v-for="a in items" :key="a.ruleId" data-testid="bell-item" @click="go(a.experimentId)">
            <span class="icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>
            </span>
            <span class="item">
              <span class="row"><span class="name">{{ a.ruleName }}</span><span class="when">{{ formatRelativeTime(a.since, Date.now()) }}</span></span>
              <span class="now">{{ formatValue(a.metric, a.lastValue) }} <span class="meta">· {{ describe(a) }}</span></span>
              <span class="meta">{{ a.experimentName }}</span>
              <span class="cta">View alert →</span>
            </span>
          </MenuItem>
          <MenuItem class="manage" data-testid="bell-manage" @click="go(manageExperimentId)">Manage alerts</MenuItem>
        </template>
      </Menu>
    </Button>
  </div>
</template>

<style scoped>
.bell { position: relative; display: inline-flex; }
.badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--mt-err-ink, #b42318); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.bell-menu { min-width: 380px; padding: 0; }
.head { padding: 12px 14px 8px; }
.head-title { font-size: 15px; font-weight: 800; }
.none, .title { margin: 0; padding: 8px 14px; font-size: 12px; color: var(--mt-muted); }
.title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; background: var(--mt-soft); }
.icon { width: 32px; height: 32px; flex: none; border-radius: 50%; background: var(--mt-err-bg, rgba(200, 40, 40, 0.1)); color: var(--mt-err-ink, #b42318); display: flex; align-items: center; justify-content: center; align-self: flex-start; }
.item { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; text-align: left; }
.row { display: flex; align-items: baseline; gap: 8px; }
.name { font-weight: 800; flex: 1; }
.when { font-size: 12px; color: var(--mt-muted); }
.now { font-weight: 600; font-variant-numeric: tabular-nums; }
.meta { font-size: 12px; font-weight: 500; color: var(--mt-muted); }
.cta { margin-top: 3px; font-size: 12px; font-weight: 800; color: var(--mt-accent-text, var(--mt-accent)); }
.manage { border-top: 1px solid var(--mt-line); border-radius: 0; font-weight: 800; color: var(--mt-accent-text, var(--mt-accent)); padding: 12px 14px; }
</style>
