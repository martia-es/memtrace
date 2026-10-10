<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import { formatRelativeTime } from "@/domain/format";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useAsync } from "../composables/useAsync";
import { thresholdPhrase } from "../alert-format";
import Button from "./Button.vue";
import Menu from "./Menu.vue";
import MenuItem from "./MenuItem.vue";

/**
 * La campana de la barra superior (ADR-086): cuántas alertas están disparadas ahora en los agentes que la persona puede leer, y
 * un menú para ir a cada una. Se renueva cada minuto; un fallo de la consulta no molesta, la campana se queda como estaba.
 */
const api = useIdentityApi();
const router = useRouter();
const open = useAsync((signal) => api.listOpenAlerts(signal));
const items = computed(() => open.data.value?.items ?? []);

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void open.run();
  timer = setInterval(() => void open.run(), 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

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
        <p v-if="items.length === 0" class="none" data-testid="bell-empty">No alerts firing.</p>
        <template v-else>
          <p class="title">Firing now</p>
          <MenuItem v-for="a in items" :key="a.ruleId" data-testid="bell-item" @click="go(a.experimentId)">
            <span class="item">
              <span class="name">{{ a.ruleName }}</span>
              <span class="meta">{{ a.experimentName }} · {{ describe(a) }} · {{ formatRelativeTime(a.since, Date.now()) }}</span>
            </span>
          </MenuItem>
        </template>
      </Menu>
    </Button>
  </div>
</template>

<style scoped>
.bell { position: relative; display: inline-flex; }
.badge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--mt-err-ink, #b42318); color: #fff; font-size: 10px; font-weight: 700; line-height: 16px; text-align: center; }
.none, .title { margin: 0; padding: 8px 12px; font-size: 12px; color: var(--mt-muted); }
.title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px; }
.item { display: flex; flex-direction: column; gap: 2px; min-width: 220px; text-align: left; }
.name { font-weight: 600; }
.meta { font-size: 11px; color: var(--mt-muted); }
</style>
