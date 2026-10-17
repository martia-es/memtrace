<script setup lang="ts">
import TextInput from "@/ui/components/TextInput.vue";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { ModelQualityItemDto } from "@contract";
import { formatPricePerMillion } from "@/domain/format";
import { formatRelativeTime } from "../i18n/format";
import { compareElo, eloBarWidth, eloScale, inScope, itemsByModelId, parseScope, qualityCell, snapshotNote, type QualityScope } from "@/domain/model-quality";
import { useAsync } from "../composables/useAsync";
import { useIdentityApi } from "../composables/useIdentityApi";
import { hasPermission } from "../composables/usePermissions";
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
import ModelMatchDrawer from "../components/ModelMatchDrawer.vue";
import Pill from "../components/Pill.vue";
import SegmentedControl from "../components/SegmentedControl.vue";

const PAGE_SIZE = 50;
const LAST_EXPERIMENT_KEY = "memtrace:lastExperimentId";

const api = useTraceApi();
const identity = useIdentityApi();
const route = useRoute();
const router = useRouter();
const pricing = useAsync((signal) => api.getModelPricing(signal));
void pricing.run();

/**
 * La calidad (Arena) se mira desde un agente: «en uso» son los modelos de sus trazas y decidir una coincidencia exige `pricing:manage` en él.
 * Esta página no cuelga de un experimento, así que se usa el último que se miró, o el primero que se puede leer.
 */
const experiments = useAsync((signal) => identity.listExperiments(signal));
void experiments.run();
const experiment = computed(() => {
  const readable = (experiments.data.value ?? []).filter((e) => hasPermission(e, "experiment:read"));
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_EXPERIMENT_KEY);
  } catch {
    last = null; // sin almacenamiento (ventana privada): vale el primero
  }
  return readable.find((e) => e.id === last) ?? readable[0] ?? null;
});
const canDecide = computed(() => hasPermission(experiment.value, "pricing:manage"));
const quality = useAsync((signal) => identity.getModelQuality(experiment.value!.id, signal));
watch(experiment, (e) => e && void quality.run(), { immediate: true });
const byId = computed(() => itemsByModelId(quality.data.value));
const qualityAvailable = computed(() => !!experiment.value && !!quality.data.value && quality.data.value.source.publishedAt !== null);
const counts = computed(() => quality.data.value?.counts ?? { needsReview: 0, pending: 0, inUse: 0 });
const scale = computed(() => eloScale(quality.data.value?.items ?? []));

const scope = computed<QualityScope>({
  get: () => parseScope(route.query.show),
  set: (value) => {
    const { show: _show, ...rest } = route.query;
    void router.replace({ query: value === "all" ? rest : { ...rest, show: value } });
  },
});
const scopeOptions = computed(() => [
  { value: "all", label: "All models" },
  { value: "in_use", label: "In use", count: counts.value.inUse },
  { value: "review", label: "Needs review", count: counts.value.needsReview },
]);

// el panel de confirmación se abre desde el banner, desde la fila de un modelo o con `?review=1` (el aviso de la campana)
const reviewing = ref(false);
const focusKey = ref<string | null>(null);
function review(modelKey: string | null = null) {
  focusKey.value = modelKey;
  reviewing.value = true;
}
function closeReview() {
  reviewing.value = false;
  if (route.query.review !== undefined) {
    const { review: _review, ...rest } = route.query;
    void router.replace({ query: rest });
  }
}
watch(
  () => [route.query.review, canDecide.value] as const,
  ([flag, can]) => {
    if (flag !== undefined && can && !reviewing.value) review();
  },
  { immediate: true },
);
function reload() {
  void quality.run();
}

const search = ref("");
const provider = ref<string | undefined>(undefined);
const page = ref(1);
// cualquier cambio de filtro vuelve a la primera página: si no, se puede quedar en una página vacía
watch([search, provider, scope], () => (page.value = 1));

const providerOptions = computed(() => {
  const all = pricing.data.value?.items ?? [];
  return [...new Set(all.map((p) => p.provider))].sort().map((p) => ({ label: p, value: p }));
});

type SortKey = "modelId" | "provider" | "inputPricePerToken" | "outputPricePerToken" | "elo" | "updatedAt";
const sortKey = ref<SortKey>("modelId");
const sortDir = ref<1 | -1>(1);
watch([sortKey, sortDir], () => (page.value = 1));

function sortBy(key: SortKey) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else {
    sortKey.value = key;
    // los precios, la calidad y las fechas se miran de mayor a menor primero; los nombres, de la A a la Z
    sortDir.value = key === "modelId" || key === "provider" ? 1 : -1;
  }
}
const ariaSort = (key: SortKey) => (sortKey.value !== key ? "none" : sortDir.value === 1 ? "ascending" : "descending");

const filtered = computed(() => {
  const all = pricing.data.value?.items ?? [];
  const q = search.value.trim().toLowerCase();
  const key = sortKey.value;
  return all
    .filter((p) => (!q || p.modelId.toLowerCase().includes(q)) && (!provider.value || p.provider === provider.value) && inScope(scope.value, byId.value.get(p.modelId)))
    .sort((a, b) => (key === "elo" ? compareElo(byId.value.get(a.modelId), byId.value.get(b.modelId), sortDir.value) : (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * sortDir.value));
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

const columns = computed<{ key: SortKey; label: string }[]>(() => [
  { key: "modelId", label: "Model" },
  { key: "provider", label: "Provider" },
  { key: "inputPricePerToken", label: "Input · $ / 1M tokens" },
  { key: "outputPricePerToken", label: "Output · $ / 1M tokens" },
  ...(qualityAvailable.value ? [{ key: "elo" as const, label: "Quality · Arena Elo" }] : []),
  { key: "updatedAt", label: "Updated" },
]);

const cell = (modelId: string) => qualityCell(byId.value.get(modelId), qualityAvailable.value);
const inUse = (item: ModelQualityItemDto | undefined) => item?.inUse === true;
const source = computed(() => quality.data.value?.source ?? null);

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

    <section v-if="qualityAvailable && counts.pending > 0" class="banner" data-testid="quality-banner">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
      <span class="banner-text">
        <b>{{ counts.pending }} {{ counts.pending === 1 ? "model you use has" : "models you use have" }} no quality score yet.</b>
        Arena lists {{ counts.pending === 1 ? "it" : "them" }} under {{ counts.pending === 1 ? "a different name" : "different names" }}, so you pick which entry is the same model.
        <template v-if="canDecide">You can also do it from the button on each row.</template>
        <template v-else>Someone with the technical profile can confirm {{ counts.pending === 1 ? "it" : "them" }}.</template>
        Prices and costs are not affected.
      </span>
      <Button v-if="canDecide" variant="primary" data-testid="review-matches" @click="review()">Review matches</Button>
    </section>

    <div v-if="qualityAvailable" class="scope-row">
      <SegmentedControl :options="scopeOptions" :model-value="scope" aria-label="Models to show" @update:model-value="scope = $event as QualityScope" />
      <span v-if="experiment" class="muted small">“In use” = seen in the traces of {{ experiment.name }}, last 30 days</span>
    </div>

    <ErrorBanner v-if="pricing.error.value" :error="pricing.error.value" @retry="pricing.run()" />
    <LoadingState v-else-if="pricing.loading.value && !pricing.data.value" size="lg" />
    <EmptyState v-else-if="items.length === 0" icon="toll" title="No models found">{{ scope === "all" ? "Try a different search." : "Nothing matches this view. Try “All models”." }}</EmptyState>

    <Card padding="none" block v-else class="table-card">
      <DataTable class="pricing" sticky nowrap>
        <thead>
          <tr>
            <th v-for="c in columns" :key="c.key" :class="{ active: sortKey === c.key }" :aria-sort="ariaSort(c.key)">
              <button type="button" class="sort" @click="sortBy(c.key)">
                {{ c.label }}<span class="arrow" aria-hidden="true">{{ sortKey === c.key ? (sortDir === 1 ? "↑" : "↓") : "↕" }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in items" :key="p.modelId" :class="{ review: cell(p.modelId).kind === 'candidate' }" :data-testid="`price-row-${p.modelId}`">
            <td class="name" :title="p.modelId">
              <span class="prefix mono">{{ splitModel(p.modelId).prefix }}</span><span class="mono model">{{ splitModel(p.modelId).name }}</span>
              <Pill v-if="inUse(byId.get(p.modelId))" tone="info" class="in-use" data-testid="in-use">IN USE</Pill>
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
            <td v-if="qualityAvailable" class="quality" :data-testid="`quality-${p.modelId}`">
              <template v-for="q in [cell(p.modelId)]" :key="q.kind">
                <div v-if="q.kind === 'score'" class="score" :class="{ stale: q.stale }" :title="`${q.arenaName} · ${q.votes.toLocaleString('en-US')} votes${q.confirmed ? ' · confirmed by your team' : ''}${q.stale ? ' · no longer on the leaderboard' : ''}`">
                  <b class="elo">{{ q.elo }}</b><small class="ci">±{{ q.ci }}</small>
                  <span class="bar wide"><span class="fill quality-fill" :style="{ width: eloBarWidth(q.elo, scale) }" /></span>
                  <small class="rank">#{{ q.rank }}</small>
                  <small v-if="q.via" class="via">via {{ q.via }}</small>
                  <small v-if="q.stale" class="via">no longer ranked</small>
                </div>
                <div v-else-if="q.kind === 'candidate'" class="candidate">
                  <code class="cand-name" :title="q.arenaName">Arena: {{ q.arenaName }}</code>
                  <Button v-if="canDecide" size="sm" :data-testid="`confirm-${p.modelId}`" @click="review(byId.get(p.modelId)?.modelKey ?? null)">Confirm match →</Button>
                  <Pill v-else tone="warn">Awaiting confirmation</Pill>
                </div>
                <span v-else-if="q.kind === 'no_equivalent'" class="muted small">— Arena doesn't list it</span>
                <span v-else class="muted small">— No Arena equivalent</span>
              </template>
            </td>
            <td class="muted updated" :title="p.updatedAt">{{ formatRelativeTime(p.updatedAt, now) }}</td>
          </tr>
        </tbody>
      </DataTable>
    </Card>

    <Pagination v-if="items.length > 0" v-model:page="page" :page-count="pageCount">{{ filtered.length }} models</Pagination>

    <p v-if="qualityAvailable && source" class="attribution muted small" data-testid="quality-attribution">
      Quality is the Elo of the model's <a :href="source.url" target="_blank" rel="noopener">Arena</a> text leaderboard (overall), ± its 95 % interval. It measures human preference in chat, not accuracy on your task.
      Leaderboard of {{ snapshotNote(source.publishedAt) }}, licensed {{ source.license }}.
    </p>
    <p v-else-if="experiment && !quality.loading.value && !quality.error.value && source" class="attribution muted small" data-testid="quality-pending-sync">
      Quality scores from Arena appear here after the first daily sync.
    </p>

    <ModelMatchDrawer v-if="reviewing && experiment" :experiment-id="experiment.id" :focus-key="focusKey" @close="closeReview" @changed="reload" />
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

.banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--mt-radius-lg);
  background: var(--mt-accent-soft);
  border: 1px solid var(--mt-line);
  color: var(--mt-accent-text);
}
.banner svg { flex: none; }
.banner-text { flex: 1; color: var(--mt-ink); line-height: 1.45; }
.scope-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.small { font-size: 12px; }
.in-use { margin-left: 8px; vertical-align: middle; }
tr.review { background: color-mix(in srgb, var(--mt-warn-bg) 35%, transparent); }
.quality { min-width: 360px; }
.score { display: flex; align-items: center; gap: 10px; }
.score.stale { opacity: 0.7; }
.elo { min-width: 44px; font-size: 14px; font-variant-numeric: tabular-nums; }
.ci, .rank { color: var(--mt-faint); font-variant-numeric: tabular-nums; }
.via { color: var(--mt-faint); white-space: nowrap; }
.bar.wide { width: 84px; flex: none; }
.quality-fill { background: var(--mt-accent); }
.candidate { display: flex; align-items: center; gap: 10px; }
.cand-name { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--mt-muted); }
.attribution { margin: 0; line-height: 1.5; }
.attribution a { color: var(--mt-accent-text); font-weight: 700; }
</style>
