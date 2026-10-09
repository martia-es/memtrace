<script setup lang="ts">
import { useRoute } from "vue-router";
import { describeRule, requestTitle } from "@/domain/approvals";
import { formatRelativeTime } from "@/domain/format";
import { useApprovalInbox } from "../composables/useApprovalInbox";

/**
 * "Waiting for your approval" (ADR-076): las solicitudes vivas de la organización que esta persona puede decidir y aún no
 * ha respondido (compartido con el menú y el listado de prompts). No pinta nada si no hay ninguna. Abrir una lleva a la pestaña Approvals de su prompt.
 */
const route = useRoute();
const items = useApprovalInbox().items;
const nowMs = Date.now();
const link = (promptId: string) => ({ name: "prompt", params: { experimentId: String(route.params.experimentId), promptId }, query: { tab: "approvals" } });
</script>

<template>
  <section v-if="items.length > 0" class="inbox" data-testid="approval-inbox">
    <header class="inbox-head">
      <span class="inbox-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10" /></svg>
      </span>
      <div class="inbox-body">
        <h2>Waiting for your approval <span class="count">{{ items.length }}</span></h2>
        <p>{{ items.length === 1 ? "A change to a prompt is waiting for your decision." : "Changes to prompts are waiting for your decision." }}</p>
      </div>
    </header>
    <ul>
      <li v-for="r in items" :key="r.id" :data-testid="`inbox-${r.id}`">
        <router-link :to="link(r.promptId)">
          <span class="what">
            <b>{{ r.promptName }}</b>
            <span>{{ requestTitle(r) }}</span>
          </span>
          <span class="muted">{{ describeRule(r.rule, {}) }} · asked by {{ (r.requestedBy && r.people[r.requestedBy]) || "someone" }} {{ formatRelativeTime(r.createdAt, nowMs) }}</span>
          <span class="review">Review →</span>
        </router-link>
      </li>
    </ul>
  </section>
</template>

<style scoped>
/* misma familia que el banner de salud del Overview, en el color de la organización (--mt-accent) */
.inbox {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--mt-radius-lg);
  border: 1px solid color-mix(in srgb, var(--mt-accent) 30%, transparent);
  background: var(--mt-accent-tint);
  color: var(--mt-accent-text);
}
.inbox-head { display: flex; align-items: center; gap: 16px; }
.inbox-icon { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; background: var(--mt-accent); color: var(--mt-accent-ink); }
.inbox-body { flex: 1; min-width: 0; }
h2 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.inbox-body p { margin: 2px 0 0; font-weight: 500; }
.count { padding: 1px 9px; border-radius: 999px; background: var(--mt-accent); color: var(--mt-accent-ink); font-size: 12px; font-weight: 700; }
ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
a {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  padding: 9px 12px;
  border-radius: var(--mt-radius-sm);
  border: 1px solid color-mix(in srgb, var(--mt-accent) 20%, transparent);
  background: var(--mt-card);
  color: var(--mt-ink);
  text-decoration: none;
  font-size: 13px;
}
a:hover { border-color: var(--mt-accent); }
.what { display: flex; align-items: baseline; gap: 10px; }
.muted { flex: 1; min-width: 0; color: var(--mt-muted); font-size: 12px; }
.review { font-weight: 700; color: var(--mt-accent-text); white-space: nowrap; }
</style>
