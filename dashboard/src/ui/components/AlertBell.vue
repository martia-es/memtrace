<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import { bellTime, notificationView, openAlertView } from "../alert-format";
import Button from "./Button.vue";
import Menu from "./Menu.vue";
import TabBar from "./TabBar.vue";
import MenuItem from "./MenuItem.vue";
import { t, tp } from "../i18n";

/**
 * La campana de la barra superior (ADR-086, ADR-094): las alertas disparadas ahora en los agentes que la persona puede leer, y debajo los
 * avisos recientes (alertas resueltas, avisos de presupuesto) con los que aún no ha leído marcados. Se renueva cada minuto; un fallo de la
 * consulta no molesta, la campana se queda como estaba.
 */
const api = useIdentityApi();
const router = useRouter();
const route = useRoute();
const open = useAsync((signal) => api.listOpenAlerts(signal));
const feed = useAsync((signal) => api.listNotifications(signal));
// modelos en uso que esperan una decisión de calidad (ADR-025): estado vivo como las alertas, no un evento. Un fallo no molesta.
const models = useAsync((signal) => api.getModelQualityPending(signal));
const pendingModels = computed(() => models.data.value ?? { total: 0, items: [] });
const items = computed(() => open.data.value?.items ?? []);

type Tab = "all" | "firing" | "budget" | "models";
const tab = ref<Tab>("all");
const menu = ref<InstanceType<typeof Menu> | null>(null);

// Una alerta que sigue disparada ya sale arriba, en «Firing now»: su aviso de «fired» no se repite abajo.
const openRules = computed(() => new Set(items.value.map((a) => a.ruleId)));
const earlier = computed(() => (feed.data.value?.items ?? []).filter((n) => !(n.kind === "fired" && n.ruleId !== null && openRules.value.has(n.ruleId))));
const budgetItems = computed(() => earlier.value.filter((n) => n.kind.startsWith("budget_")));
const unreadEarlier = computed(() => earlier.value.filter((n) => !n.read).length);
const unreadFiring = computed(() => items.value.filter((a) => !a.read).length);
// el número de la campana: lo que está roto ahora y no ha visto, más lo nuevo que no ha visto
const attention = computed(() => unreadFiring.value + unreadEarlier.value + (pendingModels.value.total > 0 ? 1 : 0));
const unreadTotal = computed(() => unreadFiring.value + unreadEarlier.value);

const showFiring = computed(() => tab.value === "all" || tab.value === "firing");
const showEarlier = computed(() => tab.value === "all" || tab.value === "budget");
const showModels = computed(() => (tab.value === "all" || tab.value === "models") && pendingModels.value.total > 0);
const earlierShown = computed(() => (tab.value === "budget" ? budgetItems.value : earlier.value));
const empty = computed(() => (showFiring.value ? items.value.length === 0 : true) && (showEarlier.value ? earlierShown.value.length === 0 : true) && !showModels.value);

function refresh() {
  void open.run();
  void feed.run();
  void models.run();
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
    await Promise.all([feed.run(), open.run()]);
  }
}
/** Cuántas direcciones reciben también el correo de lo que se gestiona desde «Manage alerts». */
const emailCount = computed(() => {
  const mine = [...items.value, ...earlier.value].filter((n) => n.experimentId === manageExperimentId.value);
  return Math.max(0, ...mine.map((n) => n.recipients));
});
const tabs = computed<Array<{ id: Tab; label: string; count: number }>>(() => [
  { id: "all", label: t("bell.tab.all"), count: items.value.length + earlier.value.length + (pendingModels.value.total > 0 ? 1 : 0) },
  { id: "firing", label: t("bell.tab.firing"), count: items.value.length },
  { id: "budget", label: t("bell.tab.budget"), count: budgetItems.value.length },
  ...(pendingModels.value.total > 0 ? [{ id: "models" as Tab, label: t("bell.tab.models"), count: pendingModels.value.total }] : []),
]);
/** «Review matches» lleva a Model pricing con el panel de confirmación abierto */
function reviewModels() {
  menu.value?.hide();
  void router.push({ name: "model-pricing", query: { review: "1" } });
}
const modelNames = computed(() => {
  const names = pendingModels.value.items.map((m) => m.model);
  return names.length > 2 ? t("bell.namesMore", { a: names[0]!, b: names[1]!, n: names.length - 2 }) : names.length === 2 ? t("bell.namesAnd", { a: names[0]!, b: names[1]! }) : names.join("");
});
const label = computed(() => {
  if (unreadFiring.value) return t("bell.label.firing", { count: unreadFiring.value });
  if (pendingModels.value.total) return t("bell.label.models", { count: pendingModels.value.total });
  return unreadEarlier.value ? t("bell.label.unread", { count: unreadEarlier.value }) : t("nav.alerts");
});
</script>

<template>
  <div class="bell" data-testid="alert-bell">
    <Button variant="icon" :aria-label="label" @click="refresh()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      <span v-if="attention" class="badge" :class="{ calm: unreadFiring === 0 }" data-testid="bell-count">{{ attention > 9 ? "9+" : attention }}</span>
      <Menu ref="menu" anchor="bottom right" self="top right" :offset="[0, 6]" class="bell-menu">
        <div class="head">
          <span class="head-title">{{ t("bell.notifications") }}</span>
          <Button size="sm" variant="link" :disabled="unreadTotal === 0" data-testid="bell-mark-read" @click="markAllRead">{{ t("bell.markAllRead") }}</Button>
        </div>
        <TabBar class="tabs" :class="{ alarmed: items.length > 0 }" :tabs="tabs" :model-value="tab" @update:model-value="tab = $event as Tab" />

        <p v-if="empty" class="none" data-testid="bell-empty">{{ tab === "budget" ? t("bell.empty.budget") : tab === "models" ? t("bell.empty.models") : t("bell.empty.alerts") }}</p>

        <template v-if="showModels">
          <p class="title">{{ t("bell.needsDecision", { count: pendingModels.total }) }}</p>
          <MenuItem data-testid="bell-models" @click="reviewModels">
            <span class="icon t-info" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            </span>
            <span class="item">
              <span class="row"><span class="name">{{ pendingModels.total === 1 ? t("bell.modelOne") : t("bell.modelMany", { count: pendingModels.total }) }}</span><span class="when">{{ t("bell.pending") }}</span></span>
              <span class="now">{{ t(pendingModels.total === 1 ? "bell.modelHas" : "bell.modelHave", { names: modelNames }) }}</span>
              <span class="meta">{{ t("bell.arenaNote") }}</span>
              <span class="cta">{{ t("bell.reviewMatches") }}</span>
            </span>
            <span class="dot" data-testid="bell-models-dot" :aria-label="t('bell.needsDecisionLabel')" />
          </MenuItem>
        </template>

        <template v-if="showFiring && items.length > 0">
          <p class="title">{{ t("bell.firingNow", { count: items.length }) }}</p>
          <MenuItem v-for="a in items" :key="a.ruleId" data-testid="bell-item" @click="go(a.experimentId)">
            <span class="icon t-error" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>
            </span>
            <span class="item">
              <span class="row"><span class="name">{{ a.ruleName }}</span><span class="when">{{ bellTime(a.since, Date.now()) }}</span></span>
              <span class="now">{{ openAlertView(a).text }}</span>
              <span class="meta">{{ a.experimentName }} · {{ openAlertView(a).detail }}</span>
              <span class="cta">{{ t("bell.viewAlertCta") }}</span>
            </span>
            <span v-if="!a.read" class="dot t-error" data-testid="bell-firing-dot" :aria-label="t('bell.firingNowLabel')" />
          </MenuItem>
        </template>

        <template v-if="showEarlier && earlierShown.length > 0">
          <p class="title">{{ t("bell.earlier") }}</p>
          <MenuItem v-for="n in earlierShown" :key="n.id" data-testid="bell-notification" @click="go(n.experimentId)">
            <span class="icon" :class="`t-${notificationView(n).tone}`" aria-hidden="true">
              <svg v-if="n.kind === 'resolved'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              <svg v-else-if="n.kind.startsWith('budget_')" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>
            </span>
            <span class="item">
              <span class="row"><span class="name">{{ notificationView(n).title }}</span><span class="when">{{ bellTime(n.at, Date.now()) }}</span></span>
              <span class="now">{{ notificationView(n).text }}</span>
              <span class="meta">{{ n.experimentName }}<template v-if="notificationView(n).detail"> · {{ notificationView(n).detail }}</template></span>
              <span class="cta">{{ notificationView(n).cta }} →</span>
            </span>
            <span v-if="!n.read" class="dot" :class="`t-${notificationView(n).tone}`" data-testid="bell-unread" :aria-label="t('bell.unread')" />
          </MenuItem>
        </template>

        <div v-if="manageExperimentId" class="foot">
          <MenuItem class="manage" data-testid="bell-manage" @click="go(manageExperimentId)">{{ t("bell.manage") }}</MenuItem>
          <span v-if="emailCount > 0" class="mail" data-testid="bell-email">{{ tp("bell.emailSent", emailCount) }}</span>
          <span v-else-if="tab === 'models'" class="mail" data-testid="bell-models-note">{{ t("bell.modelsNoEmail") }}</span>
        </div>
      </Menu>
    </Button>
  </div>
</template>

<style scoped>
.bell { position: relative; display: inline-flex; }
.badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--mt-err-ink, #b42318); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.badge.calm { background: var(--mt-accent); }
.bell-menu { width: 456px; max-width: calc(100vw - 16px); padding: 0; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 4px; }
.head-title { font-size: 18px; font-weight: 800; }
.tabs { padding: 0 10px; }
.tabs.alarmed :deep([data-testid='tab-firing'] .tab-count) { background: var(--mt-err-ink, #b42318); color: #fff; font-weight: 700; }
.tabs :deep(.tab-count) { min-width: 18px; padding: 0 5px; box-sizing: border-box; text-align: center; }
.none, .title { margin: 0; padding: 8px 18px; font-size: 12px; color: var(--mt-muted); }
.title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; background: var(--mt-soft); }
.icon { width: 32px; height: 32px; flex: none; border-radius: 50%; background: var(--mt-soft); color: var(--mt-muted); display: flex; align-items: center; justify-content: center; align-self: flex-start; }
.icon.t-error { background: var(--mt-err-bg, rgba(200, 40, 40, 0.1)); color: var(--mt-err-ink, #b42318); }
.icon.t-ok { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.icon.t-info { background: var(--mt-accent-soft); color: var(--mt-accent-text); }
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
.foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--mt-line); padding-right: 18px; }
.manage { flex: none; border-radius: 0; font-weight: 800; color: var(--mt-accent-text, var(--mt-accent)); padding: 12px 18px; }
.mail { font-size: 12px; color: var(--mt-muted); text-align: right; }
</style>
