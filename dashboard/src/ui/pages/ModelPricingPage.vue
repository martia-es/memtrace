<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, ref, watch } from "vue";
import { formatPricePerMillion, formatRelativeTime } from "@/domain/format";
import { useAsync } from "../composables/useAsync";
import { useTraceApi } from "../composables/useTraceApi";
import EmptyState from "../components/EmptyState.vue";
import ErrorBanner from "../components/ErrorBanner.vue";
import FilterPill from "../components/FilterPill.vue";
import PageHeader from "../components/PageHeader.vue";
import Button from "../components/Button.vue";
import Pagination from "../components/Pagination.vue";
import DataTable from "../components/DataTable.vue";
import LoadingState from "../components/LoadingState.vue";
import Card from "../components/Card.vue";

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

type SortKey = "modelId" | "provider" | "inputPricePerToken" | "outputPricePerToken" | "updatedAt";
const sortKey = ref<SortKey>("modelId");
const sortDir = ref<1 | -1>(1);
watch([sortKey, sortDir], () => (page.value = 1));

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else {
    sortKey.value = key;
    // los precios y fechas se miran de mayor a menor primero; los nombres, de la A a la Z
    sortDir.value = key === "modelId" || key === "provider" ? 1 : -1;
  }
}
const ariaSort = (key: SortKey) => (sortKey.value !== key ? "none" : sortDir.value === 1 ? "ascending" : "descending");

const filtered = computed(() => {
  const all = pricing.data.value?.items ?? [];
  const q = search.value.trim().toLowerCase();
  const key = sortKey.value;
  return all
    .filter((p) => (!q || p.modelId.toLowerCase().includes(q)) && (!provider.value || p.provider === provider.value))
    .sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * sortDir.value);
});

/** Escala logarítmica: los precios van de céntimos a decenas de dólares por millón y una lineal dejaría casi todas las barras vacías. */
const priceRange = computed(() => {
  const prices = (pricing.data.value?.items ?? []).flatMap((p) => [p.inputPricePerToken, p.outputPricePerToken]).filter((v) => v > 0);
  return prices.length ? { min: Math.log10(Math.min(...prices)), max: Math.log10(Math.max(...prices)) } : null;
});
function barWidth(pricePerToken: number): string {
  const r = priceRange.value;
  if (!r || pricePerToken <= 0) return "0%";
  const span = r.max - r.min || 1;
  return `${Math.round(6 + ((Math.log10(pricePerToken) - r.min) / span) * 94)}%`;
}

/** Tono estable por proveedor para distinguirlos de un vistazo. */
function providerHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function splitModel(id: string): { prefix: string; name: string } {
  const i = id.lastIndexOf("/");
  return i < 0 ? { prefix: "", name: id } : { prefix: id.slice(0, i + 1), name: id.slice(i + 1) };
}

const now = Date.now();

const columns: { key: SortKey; label: string; num?: boolean }[] = [
  { key: "modelId", label: "Model" },
  { key: "provider", label: "Provider" },
  { key: "inputPricePerToken", label: "Input · $ / 1M tokens" },
  { key: "outputPricePerToken", label: "Output · $ / 1M tokens" },
  { key: "updatedAt", label: "Updated" },
];

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
const items = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
</script>

<template>
  <div class="page">
    <PageHeader :crumbs="[{ label: 'Model pricing' }]" icon="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" title="Model pricing">
      <div class="actions">
        <FilterPill label="Provider" :model-value="provider" :options="providerOptions" all-label="All providers" @update:model-value="provider = $event" />
        <TextInput type="search" v-model="search" placeholder="Filter by model…" class="search" />
      </div>
    </PageHeader>

    <p class="hint muted">
      Per-model price catalog, synced daily from
      <a href="https://github.com/BerriAI/litellm" target="_blank" rel="noopener">LiteLLM</a>.
      It is used to compute the cost of every LLM span in the trace and conversation views.
    </p>

    <ErrorBanner v-if="pricing.error.value" :error="pricing.error.value" @retry="pricing.run()" />
    <LoadingState v-else-if="pricing.loading.value && !pricing.data.value" size="lg" />
    <EmptyState v-else-if="items.length === 0" icon="toll" title="No models found">Try a different search.</EmptyState>

    <Card padding="none" block v-else class="table-card">
      <DataTable class="pricing" sticky nowrap>
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.key" :class="{ num: c.num, active: sortKey === c.key }" :aria-sort="ariaSort(c.key)">
              <button type="button" class="sort" @click="sortBy(c.key)">
                {{ c.label }}<span class="arrow" aria-hidden="true">{{ sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : "↕" }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in items" :key="p.modelId">
            <td class="name" :title="p.modelId">
              <span class="prefix mono">{{ splitModel(p.modelId).prefix }}</span><span class="mono model">{{ splitModel(p.modelId).name }}</span>
            </td>
            <td><span class="provider" :style="{ '--h': providerHue(p.provider) }">{{ p.provider }}</span></td>
            <td class="price">
              <span v-if="p.inputPricePerToken <= 0" class="free">Free</span>
              <template v-else>
                <span class="mono value">{{ formatPricePerMillion(p.inputPricePerToken) }}</span>
                <span class="bar"><span class="fill" :style="{ width: barWidth(p.inputPricePerToken) }" /></span>
              </template>
            </td>
            <td class="price">
              <span v-if="p.outputPricePerToken <= 0" class="free">Free</span>
              <template v-else>
                <span class="mono value">{{ formatPricePerMillion(p.outputPricePerToken) }}</span>
                <span class="bar"><span class="fill out" :style="{ width: barWidth(p.outputPricePerToken) }" /></span>
              </template>
            </td>
            <td class="muted updated" :title="p.updatedAt">{{ formatRelativeTime(p.updatedAt, now) }}</td>
          </tr>
        </tbody>
      </DataTable>
    </Card>

    <Pagination v-if="items.length > 0" v-model:page="page" :page-count="pageCount">{{ filtered.length }} models</Pagination>
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
.table-card {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}

.sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--mt-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
}
.sort:hover,
th.active .sort {
  color: var(--mt-ink);
}
.arrow {
  font-size: 12px;
  opacity: 0.45;
}
th.active .arrow {
  color: var(--mt-accent);
  opacity: 1;
}

.name {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prefix {
  color: var(--mt-faint);
  font-size: 12px;
}
.model {
  font-size: 12.5px;
  font-weight: 700;
}
.provider {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, hsl(var(--h) 70% 50%) 14%, transparent);
  color: color-mix(in srgb, hsl(var(--h) 65% 42%) 70%, var(--mt-ink));
  font-size: 11.5px;
  font-weight: 700;
}
.price {
  width: 210px;
}
.value {
  display: block;
  margin-bottom: 4px;
  font-size: 12.5px;
  font-weight: 600;
}
.bar {
  display: block;
  width: 120px;
  height: 4px;
  border-radius: 2px;
  background: var(--mt-soft);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--mt-brand);
}
.fill.out {
  background: var(--mt-highlight);
}
.free {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--mt-radius-xs);
  background: var(--mt-ok-bg);
  color: var(--mt-ok-ink);
  font-size: 11.5px;
  font-weight: 700;
}
.updated {
  font-size: 12.5px;
}

</style>
