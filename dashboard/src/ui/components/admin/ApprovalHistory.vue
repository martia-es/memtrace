<script setup lang="ts">
import { computed, ref } from "vue";
import type { ApprovalRequestDto } from "@contract";
import type { ApprovalScope } from "@/application/prompt-api";
import { describeApiError } from "@/application/describe-api-error";
import { REQUEST_STATUS, describeRule, requestTitle } from "@/domain/approvals";
import { formatDateTime } from "@/domain/format";
import { usePromptApi } from "../../composables/usePromptApi";
import StatusChip from "../StatusChip.vue";

/**
 * Histórico de aprobaciones (ADR-076) de la organización o de un experimento: cada solicitud con su estado, quién la pidió
 * y qué respondió cada aprobador, las más recientes primero. Solo lectura: decidir se hace desde el prompt o la bandeja.
 */
const props = defineProps<{ scope: ApprovalScope }>();

const api = usePromptApi();
const items = ref<ApprovalRequestDto[] | null>(null);
const error = ref<string | null>(null);
const filter = ref<"all" | ApprovalRequestDto["status"]>("all");

async function load() {
  try {
    items.value = await api.approvalHistory(props.scope);
  } catch (e) {
    error.value = describeApiError(e as Error);
  }
}
void load();

const FILTERS: Array<{ id: "all" | ApprovalRequestDto["status"]; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Waiting" },
  { id: "executed", label: "Done" },
  { id: "rejected", label: "Rejected" },
  { id: "cancelled", label: "Cancelled" },
  { id: "expired", label: "Expired" },
];
const shown = computed(() => (items.value ?? []).filter((r) => filter.value === "all" || r.status === filter.value));
const countOf = (id: string) => (id === "all" ? (items.value ?? []).length : (items.value ?? []).filter((r) => r.status === id).length);
const person = (r: ApprovalRequestDto, id: string | null) => (id && r.people[id]) || "Someone";
const link = (r: ApprovalRequestDto) => (props.scope.type === "experiment" ? { name: "prompt", params: { experimentId: props.scope.id, promptId: r.promptId }, query: { tab: "approvals" } } : null);
</script>

<template>
  <div class="history" data-testid="approval-history">
    <h3 class="adm-section-title">Approval history</h3>
    <p v-if="error" class="adm-empty" role="alert">{{ error }}</p>
    <p v-else-if="!items" class="adm-hint">Loading the history…</p>
    <p v-else-if="items.length === 0" class="adm-empty" data-testid="history-empty">Nothing has been sent for approval yet.</p>
    <template v-else>
      <div class="filters" role="group" aria-label="Filter by status">
        <button v-for="f in FILTERS" :key="f.id" type="button" class="filter" :class="{ on: filter === f.id }" :aria-pressed="filter === f.id" :data-testid="`history-filter-${f.id}`" @click="filter = f.id">
          {{ f.label }} <span class="n">{{ countOf(f.id) }}</span>
        </button>
      </div>
      <p v-if="shown.length === 0" class="adm-hint">No requests with that status.</p>
      <ul v-else class="rows">
        <li v-for="r in shown" :key="r.id" class="row" :data-testid="`history-${r.id}`">
          <div class="top">
            <StatusChip :tone="REQUEST_STATUS[r.status].tone" :label="REQUEST_STATUS[r.status].label" />
            <router-link v-if="link(r)" class="what" :to="link(r)!"><b>{{ r.promptName }}</b> · {{ requestTitle(r) }}</router-link>
            <span v-else class="what"><b>{{ r.promptName }}</b> · {{ requestTitle(r) }}</span>
            <span class="when">{{ formatDateTime(r.createdAt) }}</span>
          </div>
          <p class="meta">Asked by {{ person(r, r.requestedBy) }} · needed {{ describeRule(r.rule, r.people) }}</p>
          <p v-if="r.note" class="note">“{{ r.note }}”</p>
          <ul v-if="r.decisions.length > 0" class="decisions">
            <li v-for="d in r.decisions" :key="d.userId" :class="d.decision">
              <b>{{ person(r, d.userId) }}</b> {{ d.decision === "approve" ? "approved" : "rejected" }}<template v-if="d.comment"> — “{{ d.comment }}”</template>
              <span class="when">{{ formatDateTime(d.decidedAt) }}</span>
            </li>
          </ul>
          <p v-if="r.executionError" class="problem">{{ r.executionError }}</p>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.history { display: flex; flex-direction: column; gap: 10px; }
.filters { display: flex; flex-wrap: wrap; gap: 6px; }
.filter { height: 28px; padding: 0 10px; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--mt-muted); background: transparent; border: 1px solid var(--mt-line); border-radius: 999px; cursor: pointer; }
.filter.on { color: var(--mt-ink); background: var(--mt-soft); border-color: var(--mt-ink); }
.filter .n { margin-left: 4px; font-weight: 600; opacity: 0.7; }
.rows { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.row { display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); }
.top { display: flex; align-items: center; gap: 10px; }
.what { flex: 1; min-width: 0; font-size: 13.5px; color: var(--mt-ink); text-decoration: none; }
a.what:hover { text-decoration: underline; }
.when { font-size: 12px; color: var(--mt-muted); white-space: nowrap; }
.meta, .note { margin: 0; font-size: 12.5px; color: var(--mt-muted); }
.decisions { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0; padding: 0; list-style: none; font-size: 12.5px; }
.decisions li { display: flex; gap: 6px; align-items: baseline; }
.decisions li .when { margin-left: auto; }
.decisions .approve b { color: var(--mt-ok-ink); }
.decisions .reject b { color: var(--mt-err-ink); }
.problem { margin: 0; font-size: 12.5px; color: var(--mt-err-ink); }
</style>
