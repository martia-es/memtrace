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
    <h2>Waiting for your approval <span class="count">{{ items.length }}</span></h2>
    <ul>
      <li v-for="r in items" :key="r.id" :data-testid="`inbox-${r.id}`">
        <router-link :to="link(r.promptId)">
          <b>{{ r.promptName }}</b>
          <span>{{ requestTitle(r) }}</span>
          <span class="muted">{{ describeRule(r.rule, {}) }} · asked by {{ (r.requestedBy && r.people[r.requestedBy]) || "someone" }} {{ formatRelativeTime(r.createdAt, nowMs) }}</span>
        </router-link>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.inbox { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--mt-line); border-left: 3px solid var(--mt-accent); border-radius: var(--mt-radius-sm); }
h2 { margin: 0; font-size: 14px; }
.count { margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: var(--mt-accent); color: var(--mt-accent-ink); font-size: 11px; }
ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
a { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; color: var(--mt-ink); text-decoration: none; font-size: 13px; padding: 4px 0; }
a:hover b { text-decoration: underline; }
.muted { color: var(--mt-muted); font-size: 12px; }
</style>
