<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { formatDateTime, formatPricePerMillion } from "@/domain/format";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterPill from "../components/FilterPill.vue";
import PageHeader from "../components/PageHeader.vue";

const PAGE_SIZE = 50;

const api = useTraceApi();
const pricing = useAsync((signal) => api.getModelPricing(signal));
void pricing.run();

const search = ref("");
const provider = ref<string | undefined>(undefined);
const page = ref(1);
// cualquier cambio de filtro vuelve a la primera página: si no, se puede quedar en una página vacía
watch([search, provider], () => (page.value = 1));

const providerOptions = computed(() => {
  const all = pricing.data.value?.items ?? [];
  return [...new Set(all.map((p) => p.provider))].sort().map((p) => ({ label: p, value: p }));
});

const filtered = computed(() => {
  const all = pricing.data.value?.items ?? [];
  const q = search.value.trim().toLowerCase();
  return all.filter((p) => (!q || p.modelId.toLowerCase().includes(q)) && (!provider.value || p.provider === provider.value));
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const items = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Model pricing' }]" icon="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" title="Model pricing">
      <div class="actions">
        <FilterPill label="Provider" :model-value="provider" :options="providerOptions" all-label="All providers" @update:model-value="provider = $event" />
        <q-input v-model="search" dense outlined placeholder="Filter by model…" class="search" clearable>
          <template #prepend><q-icon name="search" size="18px" /></template>
        </q-input>
      </div>
    </PageHeader>

    <p class="hint muted">
      Per-model price catalog, synced daily from
      <a href="https://github.com/BerriAI/litellm" target="_blank" rel="noopener">LiteLLM</a>.
      It is used to compute the cost of every LLM span in the trace and conversation views.
    </p>

    <ErrorBanner v-if="pricing.error.value" :error="pricing.error.value" @retry="pricing.run()" />
    <div v-else-if="pricing.loading.value && !pricing.data.value" class="loading"><q-spinner size="32px" color="primary" /></div>
    <EmptyState v-else-if="items.length === 0" icon="toll" title="No models found">Try a different search.</EmptyState>

    <div v-else class="mt-card table-card">
      <table class="pricing">
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th class="num">Input ($ / 1M tokens)</th>
            <th class="num">Output ($ / 1M tokens)</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in items" :key="p.modelId">
            <td class="mono name" :title="p.modelId">{{ p.modelId }}</td>
            <td class="muted">{{ p.provider }}</td>
            <td class="num mono">{{ formatPricePerMillion(p.inputPricePerToken) }}</td>
            <td class="num mono">{{ formatPricePerMillion(p.outputPricePerToken) }}</td>
            <td class="muted mono">{{ formatDateTime(p.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="items.length > 0" class="pager">
      <span class="muted">{{ filtered.length }} models</span>
      <div class="pager-controls">
        <button type="button" class="page-btn" :disabled="page <= 1" @click="page -= 1">Prev</button>
        <span class="muted mono">Page {{ page }} / {{ pageCount }}</span>
        <button type="button" class="page-btn" :disabled="page >= pageCount" @click="page += 1">Next</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 24px 20px;
  background: var(--mt-bg);
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search {
  width: 280px;
}
.hint {
  margin: 0;
  font-size: 12.5px;
}
.hint a {
  color: var(--mt-accent-text);
  font-weight: 700;
}
.muted {
  color: var(--mt-muted);
}
.loading {
  display: flex;
  justify-content: center;
  padding: 60px;
}
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.pricing {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 34px;
  padding: 0 14px;
  background: var(--mt-soft);
  border-bottom: 1px solid var(--mt-line);
  color: var(--mt-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
}
td {
  height: 44px;
  padding: 0 14px;
  border-bottom: 1px solid var(--mt-line-2);
  white-space: nowrap;
}
.num {
  text-align: right;
}
.name {
  font-weight: 600;
}
.pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  font-size: 12.5px;
}
.pager-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-btn {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--mt-line);
  border-radius: var(--mt-radius-sm);
  background: var(--mt-card);
  color: var(--mt-ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.page-btn:hover:not(:disabled) {
  background: var(--mt-soft);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
