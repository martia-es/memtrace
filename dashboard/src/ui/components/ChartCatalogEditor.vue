<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { ChartCatalogEntryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import type { RangeParams } from "@/application/trace-api";
import { attributeLabel, isTechnicalAttribute, stepLabel } from "@/domain/custom-chart-vocabulary";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";
import Modal from "./Modal.vue";

/**
 * "Rename things" (ADR-077): el nombre de negocio de cada paso y atributo que las Custom charts ofrecen. Se guarda por experimento
 * y se aplica en todas las gráficas, incluidas las ya guardadas, porque la clave técnica no cambia. Vaciar el nombre vuelve al
 * automático. Lo que se ve es lo detectado en el rango más lo que ya se renombró, aunque hoy no tenga actividad.
 */
const props = defineProps<{ experimentId: string; range: RangeParams; entries: ChartCatalogEntryDto[] }>();
const emit = defineEmits<{ close: []; changed: [entries: ChartCatalogEntryDto[]] }>();

const traces = useTraceApi();
const identity = useIdentityApi();

const entries = ref<ChartCatalogEntryDto[]>([...props.entries]);
const steps = ref<{ stepType: string; count: number }[]>([]);
const attributes = ref<{ key: string; count: number }[]>([]);
const loading = ref(true);
const showTechnical = ref(false);

const MAX_STEPS_FOR_ATTRIBUTES = 20;
async function load() {
  loading.value = true;
  try {
    steps.value = (await traces.getStepKinds(props.range)).items;
    const types = steps.value.slice(0, MAX_STEPS_FOR_ATTRIBUTES).map((s) => s.stepType);
    attributes.value = types.length > 0 ? (await traces.getAttributeKeys({ ...props.range, stepTypes: types })).items : [];
  } catch {
    // sin datos de actividad todavía se pueden revisar los nombres ya puestos
    steps.value = [];
    attributes.value = [];
  } finally {
    loading.value = false;
  }
}
void load();

type Kind = "step" | "attribute";
interface Row {
  kind: Kind;
  key: string;
  count: number | null;
}
const id = (kind: Kind, key: string) => `${kind}:${key}`;
const entryOf = (kind: Kind, key: string) => entries.value.find((e) => e.kind === kind && e.key === key) ?? null;
const automatic = (kind: Kind, key: string) => (kind === "step" ? stepLabel(key) : attributeLabel(key));

/** Lo detectado y, detrás, lo renombrado que hoy no tiene actividad: así siempre se puede deshacer. */
function rowsOf(kind: Kind): Row[] {
  const seen: Row[] = kind === "step" ? steps.value.map((s) => ({ kind, key: s.stepType, count: s.count })) : attributes.value.filter((a) => showTechnical.value || !isTechnicalAttribute(a.key) || entryOf("attribute", a.key)).map((a) => ({ kind, key: a.key, count: a.count }));
  const keys = new Set(seen.map((r) => r.key));
  const extra = entries.value.filter((e) => e.kind === kind && !keys.has(e.key)).map((e): Row => ({ kind, key: e.key, count: null }));
  return [...seen, ...extra];
}
const stepRows = computed(() => rowsOf("step"));
const attributeRows = computed(() => rowsOf("attribute"));

const drafts = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const busy = ref<string | null>(null);
const value = (r: Row) => drafts[id(r.kind, r.key)] ?? entryOf(r.kind, r.key)?.displayName ?? "";

async function save(r: Row) {
  const key = id(r.kind, r.key);
  const draft = (drafts[key] ?? entryOf(r.kind, r.key)?.displayName ?? "").trim();
  const current = entryOf(r.kind, r.key);
  if (draft === (current?.displayName ?? "")) return;
  busy.value = key;
  delete errors[key];
  try {
    const saved = await identity.saveChartCatalogEntry(props.experimentId, { kind: r.kind, key: r.key, displayName: draft === "" ? null : draft, visibility: current?.visibility });
    entries.value = [...entries.value.filter((e) => !(e.kind === r.kind && e.key === r.key)), ...(saved ? [saved] : [])];
    delete drafts[key];
    emit("changed", entries.value);
  } catch (error) {
    errors[key] = (error as { fields?: Record<string, string> }).fields?.displayName ?? describeApiError(error as Error);
  } finally {
    busy.value = null;
  }
}

async function reset(r: Row) {
  const key = id(r.kind, r.key);
  busy.value = key;
  delete errors[key];
  try {
    await identity.deleteChartCatalogEntry(props.experimentId, r.kind, r.key);
    entries.value = entries.value.filter((e) => !(e.kind === r.kind && e.key === r.key));
    delete drafts[key];
    emit("changed", entries.value);
  } catch (error) {
    errors[key] = describeApiError(error as Error);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <Modal title="Rename things" wide @close="emit('close')">
    <div class="catalog" data-testid="catalog-editor">
      <p class="intro">Give each step and attribute the name your team uses. The new name appears in every chart, including the ones already saved. Leave it empty to use the automatic name.</p>
      <p v-if="loading" class="muted">Looking at what your agent reports…</p>

      <template v-else>
        <section v-for="section in [{ title: 'Steps', kind: 'step' as const, rows: stepRows }, { title: 'Attributes', kind: 'attribute' as const, rows: attributeRows }]" :key="section.kind">
          <header>
            <h3>{{ section.title }}</h3>
            <label v-if="section.kind === 'attribute'" class="toggle"><input v-model="showTechnical" type="checkbox" data-testid="catalog-technical" /> Show technical details</label>
          </header>
          <p v-if="section.rows.length === 0" class="muted" :data-testid="`catalog-empty-${section.kind}`">Nothing detected in this period.</p>
          <ul v-else>
            <li v-for="r in section.rows" :key="id(r.kind, r.key)" :data-testid="`catalog-row-${r.kind}-${r.key}`">
              <div class="what">
                <span class="key mono">{{ r.key }}</span>
                <span class="n muted">{{ r.count === null ? "no activity in this period" : `${r.count.toLocaleString()} seen` }}</span>
              </div>
              <input
                class="name"
                type="text"
                maxlength="80"
                :value="value(r)"
                :placeholder="automatic(r.kind, r.key)"
                :aria-label="`Name for ${r.key}`"
                :disabled="busy === id(r.kind, r.key)"
                :data-testid="`catalog-input-${r.kind}-${r.key}`"
                @input="drafts[id(r.kind, r.key)] = ($event.target as HTMLInputElement).value"
                @change="save(r)"
                @keydown.enter.prevent="save(r)"
              />
              <button v-if="entryOf(r.kind, r.key)" type="button" class="reset" :disabled="busy === id(r.kind, r.key)" :data-testid="`catalog-reset-${r.kind}-${r.key}`" @click="reset(r)">Reset</button>
              <span v-else class="reset-space" />
              <p v-if="errors[id(r.kind, r.key)]" class="error" role="alert" :data-testid="`catalog-error-${r.kind}-${r.key}`">{{ errors[id(r.kind, r.key)] }}</p>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </Modal>
</template>

<style scoped>
.catalog { display: flex; flex-direction: column; gap: 16px; min-width: min(720px, 86vw); }
.intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--mt-muted); }
h3 { margin: 0; font-size: 14px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mt-muted); }
ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
li { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(200px, 1.2fr) 60px; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--mt-line); }
.what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.key { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; }
.n, .muted { font-size: 12px; color: var(--mt-muted); }
.mono { font-family: var(--mt-font-mono, ui-monospace, monospace); }
.name { height: 34px; padding: 0 10px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; }
.reset { height: 30px; border: none; background: transparent; color: var(--mt-accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.reset:disabled, .name:disabled { opacity: 0.5; }
.error { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--mt-err-ink); }
</style>
