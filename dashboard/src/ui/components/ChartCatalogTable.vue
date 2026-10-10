<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { ChartCatalogEntryDto } from "@contract";
import { describeApiError } from "@/application/describe-api-error";
import type { RangeParams } from "@/application/trace-api";
import { attributeLabel, stepLabel } from "@/domain/custom-chart-vocabulary";
import { KIND_LABEL, automaticLabel, distinctLabel, hiddenReason, isAttributeShown, kindOf, type AttributeInfo, type Visibility } from "@/domain/attribute-visibility";
import { useIdentityApi } from "../composables/useIdentityApi";
import { useTraceApi } from "../composables/useTraceApi";

/**
 * Tabla del catálogo (ADR-078, ADR-079): el nombre de negocio de cada paso y atributo que las Custom charts ofrecen. Se guarda por experimento
 * y se aplica en todas las gráficas, incluidas las ya guardadas, porque la clave técnica no cambia. Vaciar el nombre vuelve al
 * automático. Lo que se ve es lo detectado en el rango más lo que ya se renombró, aunque hoy no tenga actividad.
 */
const props = defineProps<{ experimentId: string; range: RangeParams; entries: ChartCatalogEntryDto[]; readonly?: boolean; search?: string; manual?: boolean }>();
const emit = defineEmits<{ changed: [entries: ChartCatalogEntryDto[]]; dirty: [count: number] }>();

const traces = useTraceApi();
const identity = useIdentityApi();

const entries = ref<ChartCatalogEntryDto[]>([...props.entries]);
const steps = ref<{ stepType: string; count: number }[]>([]);
const attributes = ref<AttributeInfo[]>([]);
const loading = ref(true);
const showHidden = ref(false);

const MAX_STEPS_FOR_ATTRIBUTES = 20;
let firstLoad = true;
let seq = 0;
async function load() {
  const mine = ++seq;
  // solo la primera vez se oculta la tabla; al cambiar de periodo se refresca sin parpadeo
  loading.value = firstLoad;
  firstLoad = false;
  try {
    const found = (await traces.getStepKinds(props.range)).items;
    const types = found.slice(0, MAX_STEPS_FOR_ATTRIBUTES).map((s) => s.stepType);
    const keys = types.length > 0 ? (await traces.getAttributeKeys({ ...props.range, stepTypes: types })).items : [];
    if (mine !== seq) return; // llegó otra consulta con un periodo más nuevo
    steps.value = found;
    attributes.value = keys;
  } catch {
    if (mine !== seq) return;
    // sin datos de actividad todavía se pueden revisar los nombres ya puestos
    steps.value = [];
    attributes.value = [];
  } finally {
    if (mine === seq) loading.value = false;
  }
}
// al cambiar el periodo se vuelve a mirar qué hay; los cambios pendientes se conservan porque van por clave
watch(() => [props.range.from, props.range.to], () => void load(), { immediate: true });

type Kind = "step" | "attribute";
interface Row {
  kind: Kind;
  key: string;
  count: number | null;
  /** lo que el servidor sabe del atributo (tipo, valores distintos…); solo los atributos que tienen actividad en el rango */
  info?: AttributeInfo;
}
const id = (kind: Kind, key: string) => `${kind}:${key}`;
const entryOf = (kind: Kind, key: string) => entries.value.find((e) => e.kind === kind && e.key === key) ?? null;
const visibilityOf = (key: string): Visibility => entryOf("attribute", key)?.visibility ?? "auto";
const automatic = (kind: Kind, key: string) => (kind === "step" ? stepLabel(key) : attributeLabel(key));

/** Lo detectado y, detrás, lo renombrado que hoy no tiene actividad: así siempre se puede deshacer. */
function rowsOf(kind: Kind): Row[] {
  const seen: Row[] =
    kind === "step"
      ? steps.value.map((s) => ({ kind, key: s.stepType, count: s.count }))
      : attributes.value.filter((a) => showHidden.value || isAttributeShown(a, visibilityOf(a.key)) || entryOf("attribute", a.key)).map((a) => ({ kind, key: a.key, count: a.count, info: a }));
  const keys = new Set(seen.map((r) => r.key));
  const extra = entries.value.filter((e) => e.kind === kind && !keys.has(e.key)).map((e): Row => ({ kind, key: e.key, count: null }));
  return [...seen, ...extra];
}
/** Filtra por clave técnica o por el nombre que se ve (el puesto a mano o el automático). */
function matches(r: Row): boolean {
  const q = (props.search ?? "").trim().toLowerCase();
  if (!q) return true;
  return [r.key, entryOf(r.kind, r.key)?.displayName ?? "", automatic(r.kind, r.key)].some((s) => s.toLowerCase().includes(q));
}
const stepRows = computed(() => rowsOf("step").filter(matches));
const attributeRows = computed(() => rowsOf("attribute").filter(matches));

const drafts = reactive<Record<string, string>>({});
const errors = reactive<Record<string, string>>({});
const busy = ref<string | null>(null);
/** Modo `manual` (página): nada se guarda al salir del campo; los cambios quedan pendientes hasta «Save changes». */
const visDrafts = reactive<Record<string, Visibility>>({});
const pendingName = (r: Row) => (drafts[id(r.kind, r.key)] ?? entryOf(r.kind, r.key)?.displayName ?? "").trim();
const isDirty = (r: Row) => pendingName(r) !== (entryOf(r.kind, r.key)?.displayName ?? "") || (visDrafts[id(r.kind, r.key)] ?? visibilityOf(r.key)) !== visibilityOf(r.key);
const dirtyRows = computed(() => [...stepRows.value, ...attributeRows.value].filter(isDirty));
watch(() => dirtyRows.value.length, (n) => emit("dirty", n), { immediate: true });
const shownVisibility = (r: Row): Visibility => visDrafts[id(r.kind, r.key)] ?? visibilityOf(r.key);
const onName = (r: Row) => { if (!props.manual) void save(r); };
function onVisibility(r: Row, v: Visibility) {
  if (!props.manual) return void setVisibility(r, v);
  if (v === visibilityOf(r.key)) delete visDrafts[id(r.kind, r.key)];
  else visDrafts[id(r.kind, r.key)] = v;
}

/** Guarda todos los pendientes, uno a uno; los que fallan se quedan pendientes con su error. */
async function saveAll() {
  for (const r of dirtyRows.value) {
    const key = id(r.kind, r.key);
    const name = pendingName(r);
    busy.value = key;
    delete errors[key];
    try {
      const saved = await identity.saveChartCatalogEntry(props.experimentId, { kind: r.kind, key: r.key, displayName: name === "" ? null : name, visibility: shownVisibility(r) });
      entries.value = [...entries.value.filter((e) => !(e.kind === r.kind && e.key === r.key)), ...(saved ? [saved] : [])];
      delete drafts[key];
      delete visDrafts[key];
    } catch (error) {
      errors[key] = (error as { fields?: Record<string, string> }).fields?.displayName ?? describeApiError(error as Error);
    } finally {
      busy.value = null;
    }
  }
  emit("changed", entries.value);
}
function discard() {
  for (const k of Object.keys(drafts)) delete drafts[k];
  for (const k of Object.keys(visDrafts)) delete visDrafts[k];
  for (const k of Object.keys(errors)) delete errors[k];
}
defineExpose({ saveAll, discard });

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

/** Fuerza que un atributo se vea o se oculte en los selectores, o lo devuelve a la clasificación automática. Conserva su nombre. */
async function setVisibility(r: Row, visibility: Visibility) {
  const key = id(r.kind, r.key);
  const current = entryOf(r.kind, r.key);
  if (visibility === (current?.visibility ?? "auto")) return;
  busy.value = key;
  delete errors[key];
  try {
    const saved = await identity.saveChartCatalogEntry(props.experimentId, { kind: r.kind, key: r.key, displayName: current?.displayName ?? null, visibility });
    entries.value = [...entries.value.filter((e) => !(e.kind === r.kind && e.key === r.key)), ...(saved ? [saved] : [])];
    emit("changed", entries.value);
  } catch (error) {
    errors[key] = describeApiError(error as Error);
  } finally {
    busy.value = null;
  }
}

async function reset(r: Row) {
  const key = id(r.kind, r.key);
  busy.value = key;
  delete errors[key];
  try {
    const current = entryOf(r.kind, r.key);
    if (current && current.visibility !== "auto") {
      // el nombre vuelve al automático pero lo que se forzó (mostrar u ocultar) se queda: eso se deshace con su propio selector
      const saved = await identity.saveChartCatalogEntry(props.experimentId, { kind: r.kind, key: r.key, displayName: null, visibility: current.visibility });
      entries.value = [...entries.value.filter((e) => !(e.kind === r.kind && e.key === r.key)), ...(saved ? [saved] : [])];
    } else {
      await identity.deleteChartCatalogEntry(props.experimentId, r.kind, r.key);
      entries.value = entries.value.filter((e) => !(e.kind === r.kind && e.key === r.key));
    }
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
    <div class="catalog" data-testid="catalog-editor">
      <p v-if="loading" class="muted">Looking at what your agent reports…</p>

      <template v-else>
        <section v-for="section in [{ title: 'Steps', kind: 'step' as const, rows: stepRows }, { title: 'Attributes', kind: 'attribute' as const, rows: attributeRows }]" :key="section.kind">
          <header>
            <h3>{{ section.title }}</h3>
            <label v-if="section.kind === 'attribute'" class="toggle"><input v-model="showHidden" type="checkbox" data-testid="catalog-technical" /> Show hidden details</label>
          </header>
          <p v-if="section.rows.length === 0" class="muted" :data-testid="`catalog-empty-${section.kind}`">{{ search ? "Nothing matches your search." : "Nothing detected in this period." }}</p>
          <ul v-else>
            <li v-for="r in section.rows" :key="id(r.kind, r.key)" :class="{ dirty: manual && isDirty(r) }" :data-testid="`catalog-row-${r.kind}-${r.key}`">
              <div class="what">
                <span class="key mono">{{ r.key }}</span>
                <span class="n muted">{{ r.count === null ? "no activity in this period" : `${r.count.toLocaleString()} seen` }}<template v-if="r.info && distinctLabel(r.info)"> · {{ distinctLabel(r.info) }}</template></span>
                <span v-if="r.info" class="kind" :class="kindOf(r.info)" :data-testid="`catalog-kind-${r.kind}-${r.key}`">
                  {{ KIND_LABEL[kindOf(r.info)] }}<template v-if="r.info.numeric && kindOf(r.info) === 'category'"> · numeric</template>
                </span>
                <span v-if="r.info && hiddenReason(r.info, visibilityOf(r.key))" class="n muted" :data-testid="`catalog-why-${r.kind}-${r.key}`">{{ hiddenReason(r.info, visibilityOf(r.key)) }}</span>
              </div>
              <input
                class="name"
                type="text"
                maxlength="80"
                :value="value(r)"
                :placeholder="automatic(r.kind, r.key)"
                :aria-label="`Name for ${r.key}`"
                :disabled="readonly || busy === id(r.kind, r.key)"
                :data-testid="`catalog-input-${r.kind}-${r.key}`"
                @input="drafts[id(r.kind, r.key)] = ($event.target as HTMLInputElement).value"
                @change="onName(r)"
                @keydown.enter.prevent="onName(r)"
              />
              <select
                v-if="r.kind === 'attribute'"
                class="vis"
                :value="shownVisibility(r)"
                :aria-label="`Visibility of ${r.key}`"
                :disabled="readonly || busy === id(r.kind, r.key)"
                :data-testid="`catalog-visibility-${r.kind}-${r.key}`"
                @change="onVisibility(r, ($event.target as HTMLSelectElement).value as Visibility)"
              >
                <option value="auto">{{ r.info ? automaticLabel(r.info) : "Automatic" }}</option>
                <option value="shown">Always show</option>
                <option value="hidden">Always hide</option>
              </select>
              <button v-if="entryOf(r.kind, r.key) && entryOf(r.kind, r.key)!.displayName" type="button" class="reset" :disabled="readonly || busy === id(r.kind, r.key)" :data-testid="`catalog-reset-${r.kind}-${r.key}`" @click="reset(r)">Reset</button>
              <span v-else class="reset-space" />
              <p v-if="errors[id(r.kind, r.key)]" class="error" role="alert" :data-testid="`catalog-error-${r.kind}-${r.key}`">{{ errors[id(r.kind, r.key)] }}</p>
            </li>
          </ul>
        </section>
      </template>
    </div>
</template>

<style scoped>
.catalog { display: flex; flex-direction: column; gap: 16px; }
h3 { margin: 0; font-size: 14px; }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mt-muted); }
ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
li.dirty { box-shadow: inset 3px 0 0 var(--mt-accent); padding-left: 8px; }
li { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(180px, 1.1fr) 150px 60px; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--mt-line); }
.what { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.key { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; }
.n, .muted { font-size: 12px; color: var(--mt-muted); }
.mono { font-family: var(--mt-font-mono, ui-monospace, monospace); }
.name { height: 34px; padding: 0 10px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: transparent; color: var(--mt-ink); font: inherit; font-size: 13px; }
.kind { align-self: flex-start; padding: 1px 7px; border-radius: var(--mt-radius-xs); background: var(--mt-soft); color: var(--mt-muted); font-size: 11px; font-weight: 700; }
.kind.category, .kind.number { background: var(--mt-ok-bg); color: var(--mt-ok-ink); }
.vis { height: 34px; padding: 0 6px; border: 1px solid var(--mt-line); border-radius: var(--mt-radius-sm); background: transparent; color: var(--mt-ink); font: inherit; font-size: 12px; }
.reset { height: 30px; border: none; background: transparent; color: var(--mt-accent); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.reset:disabled, .name:disabled { opacity: 0.5; }
.error { grid-column: 1 / -1; margin: 0; font-size: 12px; color: var(--mt-err-ink); }
</style>
