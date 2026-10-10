<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatRelativeTime } from "@/domain/format";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import { formatValue, notificationView, thresholdPhrase } from "../alert-format";
import Button from "./Button.vue";
import Menu from "./Menu.vue";
import MenuItem from "./MenuItem.vue";
import ToggleChip from "./ToggleChip.vue";

/**
 * La campana de la barra superior (ADR-086, ADR-087): las alertas disparadas ahora en los agentes que la persona puede leer, y debajo los
 * avisos recientes (alertas resueltas, avisos de presupuesto) con los que aún no ha leído marcados. Se renueva cada minuto; un fallo de la
 * consulta no molesta, la campana se queda como estaba.
 */
const api = useIdentityApi();
const router = useRouter();
const route = useRoute();
const open = useAsync((signal) => api.listOpenAlerts(signal));
const feed = useAsync((signal) => api.listNotifications(signal));
const items = computed(() => open.data.value?.items ?? []);

type Tab = "all" | "firing" | "budget";
const tab = ref<Tab>("all");
const menu = ref<InstanceType<typeof Menu> | null>(null);

// Una alerta que sigue disparada ya sale arriba, en «Firing now»: su aviso de «fired» no se repite abajo.
const openRules = computed(() => new Set(items.value.map((a) => a.ruleId)));
const earlier = computed(() => (feed.data.value?.items ?? []).filter((n) => !(n.kind === "fired" && n.ruleId !== null && openRules.value.has(n.ruleId))));
const budgetItems = computed(() => earlier.value.filter((n) => n.kind.startsWith("budget_")));
const unreadEarlier = computed(() => earlier.value.filter((n) => !n.read).length);
// el número de la campana: lo que está roto ahora más lo nuevo que no ha visto
const attention = computed(() => items.value.length + unreadEarlier.value);

const showFiring = computed(() => tab.value !== "budget");
const showEarlier = computed(() => tab.value !== "firing");
const earlierShown = computed(() => (tab.value === "budget" ? budgetItems.value : earlier.value));
const empty = computed(() => (showFiring.value ? items.value.length === 0 : true) && (showEarlier.value ? earlierShown.value.length === 0 : true));

function refresh() {
  void open.run();
  void feed.run();
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

/** «Manage alerts» abre las del agente que se está mirando, o las del primero que dispara. */
const manageExperimentId = computed(() => (route.params.experimentId as string | undefined) ?? items.value[0]?.experimentId ?? earlier.value[0]?.experimentId ?? "");

function go(experimentId: string) {
  menu.value?.hide();
  void router.push({ name: "alerts", params: { experimentId } });
}
async function markAllRead() {
  try {
    await api.markNotificationsRead();
  } finally {
    await feed.run();
  }
}
const describe = (a: (typeof items.value)[number]) => thresholdPhrase(a);
const label = computed(() => {
  if (items.value.length) return `${items.value.length} alerts firing`;
  return unreadEarlier.value ? `${unreadEarlier.value} new notifications` : "Alerts";
});
</script>

<template>
  <div class="bell" data-testid="alert-bell">
    <Button variant="icon" :aria-label="label" @click="refresh()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      <span v-if="attention" class="badge" :class="{ calm: items.length === 0 }" data-testid="bell-count">{{ attention > 9 ? "9+" : attention }}</span>
      <Menu ref="menu" anchor="bottom right" self="top right" :offset="[0, 6]" class="bell-menu">
        <div class="head">
          <span class="head-title">Notifications</span>
          <Button v-if="unreadEarlier > 0" size="sm" variant="link" data-testid="bell-mark-read" @click="markAllRead">Mark all as read</Button>
        </div>
        <div class="tabs" role="group" aria-label="Filter notifications">
          <ToggleChip :pressed="tab === 'all'" :count="items.length + earlier.length" @click="tab = 'all'">All</ToggleChip>
          <ToggleChip :pressed="tab === 'firing'" :count="items.length" @click="tab = 'firing'">Firing</ToggleChip>
          <ToggleChip :pressed="tab === 'budget'" :count="budgetItems.length" @click="tab = 'budget'">Budget</ToggleChip>
        </div>

        <p v-if="empty" class="none" data-testid="bell-empty">{{ tab === "budget" ? "No budget notices." : "No alerts firing." }}</p>

        <template v-if="showFiring && items.length > 0">
          <p class="title">Firing now · {{ items.length }}</p>
          <MenuItem v-for="a in items" :key="a.ruleId" data-testid="bell-item" @click="go(a.experimentId)">
            <span class="icon t-error" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>
            </span>
            <span class="item">
              <span class="row"><span class="name">{{ a.ruleName }}</span><span class="when">{{ formatRelativeTime(a.since, Date.now()) }}</span></span>
              <span class="now">{{ formatValue(a.metric, a.lastValue) }} <span class="meta">· {{ describe(a) }}</span></span>
              <span class="meta">{{ a.experimentName }}</span>
              <span class="cta">View alert →</span>
            </span>
          </MenuItem>
        </template>

        <template v-if="showEarlier && earlierShown.length > 0">
          <p class="title">Earlier</p>
          <MenuItem v-for="n in earlierShown" :key="n.id" data-testid="bell-notification" @click="go(n.experimentId)">
            <span class="icon" :class="`t-${notificationView(n).tone}`" aria-hidden="true">
              <svg v-if="n.kind === 'resolved'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              <svg v-else-if="n.kind.startsWith('budget_')" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>
            </span>
            <span class="item">
              <span class="row"><span class="name">{{ notificationView(n).title }}</span><span class="when">{{ formatRelativeTime(n.at, Date.now()) }}</span></span>
              <span class="now">{{ notificationView(n).text }}</span>
              <span class="meta">{{ n.experimentName }}</span>
              <span class="cta">{{ notificationView(n).cta }} →</span>
            </span>
            <span v-if="!n.read" class="dot" :class="`t-${notificationView(n).tone}`" data-testid="bell-unread" aria-label="Unread" />
          </MenuItem>
        </template>

        <MenuItem v-if="manageExperimentId" class="manage" data-testid="bell-manage" @click="go(manageExperimentId)">Manage alerts</MenuItem>
      </Menu>
    </Button>
  </div>
</template>

<style scoped>
.bell { position: relative; display: inline-flex; }
.badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--mt-err-ink, #b42318); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.badge.calm { background: var(--mt-accent); }
.bell-menu { min-width: 380px; padding: 0; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px; }
.head-title { font-size: 15px; font-weight: 800; }
.tabs { display: flex; gap: 6px; padding: 4px 14px 10px; }
.none, .title { margin: 0; padding: 8px 14px; font-size: 12px; color: var(--mt-muted); }
.title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; background: var(--mt-soft); }
.icon { width: 32px; height: 32px; flex: none; border-radius: 50%; background: var(--mt-soft); color: var(--mt-muted); display: flex; align-items: center; justify-content: center; align-self: flex-start; }
.icon.t-error { background: var(--mt-err-bg, rgba(200, 40, 40, 0.1)); color: var(--mt-err-ink, #b42318); }
.icon.t-ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.icon.t-warn { background: var(--mt-warn-bg); color: var(--mt-warn-ink); }
.item { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; text-align: left; }
.row { display: flex; align-items: baseline; gap: 8px; }
.name { font-weight: 800; flex: 1; }
.when { font-size: 12px; color: var(--mt-muted); }
.now { font-weight: 600; font-variant-numeric: tabular-nums; }
.meta { font-size: 12px; font-weight: 500; color: var(--mt-muted); }
.cta { margin-top: 3px; font-size: 12px; font-weight: 800; color: var(--mt-accent-text, var(--mt-accent)); }
.dot { width: 8px; height: 8px; flex: none; border-radius: 50%; margin-top: 6px; align-self: flex-start; background: var(--mt-accent); }
.dot.t-error { background: var(--mt-err-ink); }
.dot.t-warn { background: var(--mt-warn-ink); }
.dot.t-ok { background: var(--mt-ok-ink); }
.manage { border-top: 1px solid var(--mt-line); border-radius: 0; font-weight: 800; color: var(--mt-accent-text, var(--mt-accent)); padding: 12px 14px; }
</style>
