import { tr, lazyMessages } from "./translate";
/** Vocabulario de negocio del builder de Custom charts (ADR-057).
 *
 * El modelo guardado sigue siendo técnico (`step_type`, claves de atributo, métricas cerradas);
 * aquí solo se decide cómo se *presenta* a una persona de negocio. Toda la UI pasa por estas
 * funciones, de modo que cuando exista un catálogo editable en servidor (iteración 2) solo
 * cambia el origen del nombre, no los componentes. */

export type ChartKind = "bar" | "pie" | "line" | "area" | "number" | "table";
export type AttributeMetricKind = "sum_attribute" | "avg_attribute" | "min_attribute" | "max_attribute";
export type MetricKind = "count" | "avg_duration" | "p50_duration" | "p95_duration" | "error_rate" | AttributeMetricKind;

/** Las métricas sobre un atributo numérico (ADR-078, fase 3): total, media, mínimo y máximo. Piden `metricAttribute`. */
export const ATTRIBUTE_METRICS: AttributeMetricKind[] = ["sum_attribute", "avg_attribute", "min_attribute", "max_attribute"];
export const isAttributeMetric = (metric: MetricKind): metric is AttributeMetricKind => (ATTRIBUTE_METRICS as string[]).includes(metric);

export interface ChartDefinition {
  chartType: ChartKind;
  stepTypes: string[];
  metric: MetricKind;
  /** el atributo numérico que miden las métricas `*_attribute`; null o ausente en el resto */
  metricAttribute?: string | null;
  groupByAttribute: string | null;
  filters: { attribute: string; values: string[] }[];
}

// ---- nombres editados (ADR-078) ----

/** Los nombres que el experimento ha puesto a sus pasos y atributos, por clave técnica. Tienen prioridad sobre todo lo demás. */
export interface NameCatalog {
  steps: Record<string, string>;
  attributes: Record<string, string>;
}

export const NO_NAMES: NameCatalog = { steps: {}, attributes: {} };

/** Solo cuentan las ediciones con nombre propio: una que solo cambia la visibilidad no renombra nada. */
export function buildNames(entries: ReadonlyArray<{ kind: "step" | "attribute"; key: string; displayName: string | null }>): NameCatalog {
  const names: NameCatalog = { steps: {}, attributes: {} };
  for (const e of entries) {
    if (e.displayName) (e.kind === "step" ? names.steps : names.attributes)[e.key] = e.displayName;
  }
  return names;
}

// ---- nombres de pasos ----

/** `input_guardrail` / `inputGuardrail` / `input.guardrail` → "Input guardrail". */
export function humanize(id: string): string {
  const spaced = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._\-/]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced ? spaced[0]!.toUpperCase() + spaced.slice(1) : id;
}

const BUILT_IN_STEPS: Record<string, string> = lazyMessages({
  llm: "custom-chart-vocabulary.model_calls",
  tool: "custom-chart-vocabulary.tool_calls",
  agent: "custom-chart-vocabulary.agent_runs",
  retriever: "custom-chart-vocabulary.document_searches",
  unknown: "custom-chart-vocabulary.other_steps",
});

export function isBuiltInStep(stepType: string): boolean {
  return stepType in BUILT_IN_STEPS;
}

/** Cascada de nombres: el que ha puesto la persona, el del diccionario y, si no hay, el identificador humanizado. */
export function stepLabel(stepType: string, names: NameCatalog = NO_NAMES): string {
  return names.steps[stepType] ?? BUILT_IN_STEPS[stepType] ?? humanize(stepType);
}

// ---- atributos ----

const ATTRIBUTE_LABELS: Record<string, string> = lazyMessages({
  "gen_ai.tool.name": "custom-chart-vocabulary.tool",
  "gen_ai.request.model": "custom-chart-vocabulary.model",
  "gen_ai.response.model": "custom-chart-vocabulary.model_served",
  "gen_ai.system": "custom-chart-vocabulary.provider",
  "gen_ai.operation.name": "custom-chart-vocabulary.operation",
  "gen_ai.usage.input_tokens": "custom-chart-vocabulary.input_tokens",
  "gen_ai.usage.output_tokens": "custom-chart-vocabulary.output_tokens",
  "gen_ai.usage.total_tokens": "custom-chart-vocabulary.total_tokens",
});

/** Claves que son plumbing de instrumentación: se ocultan salvo que se pidan expresamente. */
const TECHNICAL_ATTRIBUTE = /^(memtrace\.|otel\.|telemetry\.|gen_ai\.(tool\.call\.|usage\.|request\.(temperature|max_tokens|top_p)|prompt|completion|response\.id)|exception\.|code\.|thread\.|process\.)/;

export function isTechnicalAttribute(key: string): boolean {
  return TECHNICAL_ATTRIBUTE.test(key);
}

export function attributeLabel(key: string, names: NameCatalog = NO_NAMES): string {
  return names.attributes[key] ?? ATTRIBUTE_LABELS[key] ?? humanize(key);
}

// ---- métricas ----

export const METRIC_LABELS: Record<MetricKind, string> = lazyMessages({
  count: "custom-chart-vocabulary.how_many_times",
  avg_duration: "custom-chart-vocabulary.how_long_it_takes_average",
  p50_duration: "custom-chart-vocabulary.typical_time_median",
  p95_duration: "custom-chart-vocabulary.how_long_it_takes_in_the",
  error_rate: "custom-chart-vocabulary.that_fail",
  sum_attribute: "custom-chart-vocabulary.total_of_a_number",
  avg_attribute: "custom-chart-vocabulary.average_of_a_number",
  min_attribute: "custom-chart-vocabulary.lowest_value_of_a_number",
  max_attribute: "custom-chart-vocabulary.highest_value_of_a_number",
});

/** p50 sigue siendo válido en gráficas ya guardadas, pero el builder no lo ofrece. */
export const SELECTABLE_METRICS: MetricKind[] = ["count", "avg_duration", "p95_duration", "error_rate"];

const METRIC_PHRASE: Record<MetricKind, string> = lazyMessages({
  count: "custom-chart-vocabulary.the_number_of",
  avg_duration: "custom-chart-vocabulary.the_average_time_of",
  p50_duration: "custom-chart-vocabulary.the_typical_time_of",
  p95_duration: "custom-chart-vocabulary.the_time_in_the_slowest_5",
  error_rate: "custom-chart-vocabulary.the_that_fail_among",
  sum_attribute: "custom-chart-vocabulary.the_total_of",
  avg_attribute: "custom-chart-vocabulary.the_average_of",
  min_attribute: "custom-chart-vocabulary.the_lowest",
  max_attribute: "custom-chart-vocabulary.the_highest",
});

const METRIC_TITLE: Record<MetricKind, string> = lazyMessages({
  count: "custom-chart-vocabulary.count_of",
  avg_duration: "custom-chart-vocabulary.average_time_of",
  p50_duration: "custom-chart-vocabulary.typical_time_of",
  p95_duration: "custom-chart-vocabulary.slowest_5_time_of",
  error_rate: "custom-chart-vocabulary.failure_rate_of",
  sum_attribute: "custom-chart-vocabulary.total_of",
  avg_attribute: "custom-chart-vocabulary.average",
  min_attribute: "custom-chart-vocabulary.lowest",
  max_attribute: "custom-chart-vocabulary.highest",
});

/** El encabezado de la columna de valores de una tabla: "Total of order total" para una métrica sobre un atributo, la frase de siempre en el resto. */
export function metricColumnLabel(def: { metric: MetricKind; metricAttribute?: string | null }, names: NameCatalog = NO_NAMES): string {
  if (!isAttributeMetric(def.metric) || !def.metricAttribute) return METRIC_LABELS[def.metric];
  return `${METRIC_TITLE[def.metric]} ${attributeLabel(def.metricAttribute, names).toLowerCase()}`;
}

/** El API devuelve `error_rate` como fracción 0..1 y las duraciones en ms: aquí se muestran con su unidad. */
export function formatMetricValue(metric: MetricKind, value: number): string {
  if (metric === "error_rate") return `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  if (metric === "count") return value.toLocaleString();
  // una medida de negocio (un importe, una nota) no lleva unidad: son los números tal cual, con hasta dos decimales
  if (isAttributeMetric(metric)) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value >= 1000 ? `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s` : `${Math.round(value).toLocaleString()} ms`;
}

/**
 * Valor del "número único": lo que suma se suma (conteos, totales), el mínimo y el máximo toman el menor y el mayor, y lo que no es
 * sumable (tiempos, tasas, medias) usa la media simple de los puntos.
 */
export function singleNumber(metric: MetricKind, points: { value: number }[]): number {
  if (!points.length) return 0;
  if (metric === "min_attribute") return Math.min(...points.map((p) => p.value));
  if (metric === "max_attribute") return Math.max(...points.map((p) => p.value));
  const sum = points.reduce((s, p) => s + p.value, 0);
  return metric === "count" || metric === "sum_attribute" ? sum : sum / points.length;
}

// ---- comparación con el periodo anterior ----

/** El tramo inmediatamente anterior y de la misma duración: 7 días → los 7 días previos. */
export function previousRange(range: { from: string; to: string }): { from: string; to: string } {
  const from = new Date(range.from).getTime();
  const to = new Date(range.to).getTime();
  return { from: new Date(from - (to - from)).toISOString(), to: new Date(from).toISOString() };
}

export interface ChangeSummary {
  /** "▲ +2.3 pts", "▼ -12%"… listo para mostrar */
  label: string;
  direction: "up" | "down" | "flat";
  /** subir es malo (fallos, tiempos); en los conteos no se juzga */
  tone: "bad" | "good" | "neutral";
}

/** Cambio entre dos valores del mismo indicador. `null` si no hay base de comparación (periodo anterior vacío). */
export function describeChange(metric: MetricKind, current: number, previous: number): ChangeSummary | null {
  if (metric === "error_rate") {
    const pts = (current - previous) * 100;
    if (Math.abs(pts) < 0.05) return { label: tr("custom-chart-vocabulary.no_change"), direction: "flat", tone: "neutral" };
    const text = `${pts > 0 ? "+" : "-"}${Math.abs(pts).toLocaleString(undefined, { maximumFractionDigits: 1 })} pts`;
    return { label: `${pts > 0 ? "▲" : "▼"} ${text}`, direction: pts > 0 ? "up" : "down", tone: pts > 0 ? "bad" : "good" };
  }
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.5) return { label: tr("custom-chart-vocabulary.no_change"), direction: "flat", tone: "neutral" };
  const text = `${pct > 0 ? "+" : "-"}${Math.abs(pct).toLocaleString(undefined, { maximumFractionDigits: 0 })}%`;
  const direction = pct > 0 ? "up" : "down";
  // subir una cifra de negocio (ventas, notas) no es bueno ni malo por sí mismo: solo los tiempos y los fallos juzgan
  const tone = metric === "count" || isAttributeMetric(metric) ? "neutral" : pct > 0 ? "bad" : "good";
  return { label: `${direction === "up" ? "▲" : "▼"} ${text}`, direction, tone };
}

/** Un valor que destaca sobre el resto: solo en tasas de fallo y tiempos, donde "más" significa "peor". */
export function findOutlier(metric: MetricKind, points: { label: string; value: number }[]): { label: string; text: string } | null {
  if (metric === "count" || isAttributeMetric(metric) || points.length < 3) return null;
  const top = points.reduce((a, b) => (b.value > a.value ? b : a));
  const rest = points.filter((p) => p !== top);
  const mean = rest.reduce((s, p) => s + p.value, 0) / rest.length;
  if (top.value <= 0 || mean <= 0) return null;
  const ratio = top.value / mean;
  if (ratio < 1.5) return null;
  const times = ratio.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return { label: top.label, text: metric === "error_rate" ? tr("custom-chart-vocabulary.fails_times_more_than_the_others", { times }) : tr("custom-chart-vocabulary.is_times_slower_than_the_others", { times }) };
}

// ---- sugerencias y descripciones ----

/** Sin desglose lo útil es ver la evolución; con desglose, comparar categorías. */
export function suggestChartType(groupByAttribute: string | null): ChartKind {
  return groupByAttribute ? "bar" : "line";
}

/** "tool calls", "guardrail input and tool calls", "model calls, tool calls and 2 more". */
export function stepsPhrase(stepTypes: string[], catalog: NameCatalog = NO_NAMES): string {
  const names = stepTypes.map((s) => stepLabel(s, catalog).toLowerCase());
  if (names.length <= 1) return names[0] ?? tr("custom-chart-vocabulary.selected_steps");
  if (names.length === 2) return tr("custom-chart-vocabulary.a_and_b", { a: names[0]!, b: names[1]! });
  if (names.length === 3) return tr("custom-chart-vocabulary.a_b_and_c", { a: names[0]!, b: names[1]!, c: names[2]! });
  return tr("custom-chart-vocabulary.a_b_and_n_more", { a: names[0]!, b: names[1]!, n: names.length - 2 });
}

export function suggestName(def: Pick<ChartDefinition, "metric" | "stepTypes" | "groupByAttribute" | "metricAttribute">, names: NameCatalog = NO_NAMES): string {
  const step = stepsPhrase(def.stepTypes, names);
  const by = def.groupByAttribute ? ` ${tr("custom-chart-vocabulary.by_attr", { attr: attributeLabel(def.groupByAttribute, names).toLowerCase() })}` : "";
  // sobre un atributo: "Total of order total in tool calls"; el resto, como siempre: "Count of tool calls"
  if (isAttributeMetric(def.metric) && def.metricAttribute) return tr("custom-chart-vocabulary.title_attr_in_step_by", { title: METRIC_TITLE[def.metric], attr: attributeLabel(def.metricAttribute, names).toLowerCase(), step, by });
  return `${METRIC_TITLE[def.metric]} ${step}${by}`;
}

/** Una frase que sustituye al antiguo "X axis / Series". */
export function describeDefinition(def: ChartDefinition, names: NameCatalog = NO_NAMES): string {
  if (!def.stepTypes.length) return tr("custom-chart-vocabulary.pick_what_you_want_to_measure");
  const step = stepsPhrase(def.stepTypes, names);
  const attr = (key: string) => attributeLabel(key, names).toLowerCase();
  const timeBased = def.chartType === "line" || def.chartType === "area";
  const layout = timeBased
    ? def.groupByAttribute
      ? tr("custom-chart-vocabulary.over_time_one_line_per_attr", { attr: attr(def.groupByAttribute) })
      : tr("custom-chart-vocabulary.over_time")
    : def.chartType === "number"
      ? tr("custom-chart-vocabulary.as_a_single_number")
      : def.groupByAttribute
        ? tr("custom-chart-vocabulary.for_each_attr", { attr: attr(def.groupByAttribute) })
        : tr("custom-chart-vocabulary.for_each_kind_of_step");
  const active = def.filters.filter((f) => f.attribute && f.values.length);
  const only = active.length ? tr("custom-chart-vocabulary.only_when_conditions", { conditions: active.map((f) => tr("custom-chart-vocabulary.attr_is_values", { attr: attr(f.attribute), values: f.values.join(` ${tr("custom-chart-vocabulary.or")} `) })).join(` ${tr("custom-chart-vocabulary.and")} `) }) : "";
  const measured = isAttributeMetric(def.metric) && def.metricAttribute ? tr("custom-chart-vocabulary.phrase_attr_in_step", { phrase: METRIC_PHRASE[def.metric], attr: attr(def.metricAttribute), step }) : `${METRIC_PHRASE[def.metric]} ${step}`;
  return tr("custom-chart-vocabulary.shows_measured_layout_only", { measured, layout, only });
}

/** Cuando no se desglosa por atributo, las etiquetas de los puntos son step types: se muestran con su nombre de negocio. */
export function presentPointLabel(label: string, def: Pick<ChartDefinition, "groupByAttribute">, names: NameCatalog = NO_NAMES): string {
  return def.groupByAttribute ? label : stepLabel(label, names);
}

// ---- plantillas ("empieza por una pregunta") ----

export interface ChartTemplate {
  id: string;
  question: string;
  /** step types que deben existir en las trazas del rango para ofrecer la plantilla */
  requires: string[];
  definition: ChartDefinition;
}

const def = (d: Partial<ChartDefinition> & Pick<ChartDefinition, "chartType" | "stepTypes" | "metric">): ChartDefinition => ({
  groupByAttribute: null,
  filters: [],
  ...d,
});

const BUILT_IN_TEMPLATES: ChartTemplate[] = [
  { id: "tools-usage", get question() { return tr("custom-chart-vocabulary.how_often_is_each_tool_used"); }, requires: ["tool"], definition: def({ chartType: "bar", stepTypes: ["tool"], metric: "count", groupByAttribute: "gen_ai.tool.name" }) },
  { id: "tools-failing", get question() { return tr("custom-chart-vocabulary.which_tools_fail_the_most"); }, requires: ["tool"], definition: def({ chartType: "bar", stepTypes: ["tool"], metric: "error_rate", groupByAttribute: "gen_ai.tool.name" }) },
  { id: "tools-slow", get question() { return tr("custom-chart-vocabulary.which_tools_are_the_slowest"); }, requires: ["tool"], definition: def({ chartType: "bar", stepTypes: ["tool"], metric: "avg_duration", groupByAttribute: "gen_ai.tool.name" }) },
  { id: "model-calls-over-time", get question() { return tr("custom-chart-vocabulary.how_many_model_calls_do_i"); }, requires: ["llm"], definition: def({ chartType: "line", stepTypes: ["llm"], metric: "count" }) },
  { id: "model-calls-by-model", get question() { return tr("custom-chart-vocabulary.which_models_do_i_call_the"); }, requires: ["llm"], definition: def({ chartType: "pie", stepTypes: ["llm"], metric: "count", groupByAttribute: "gen_ai.request.model" }) },
  { id: "model-latency", get question() { return tr("custom-chart-vocabulary.how_long_do_model_calls_take"); }, requires: ["llm"], definition: def({ chartType: "line", stepTypes: ["llm"], metric: "avg_duration" }) },
];

/** Plantillas aplicables a lo detectado en las trazas, más dos preguntas por cada paso propio del usuario. */
export function templatesFor(stepTypes: string[], names: NameCatalog = NO_NAMES): ChartTemplate[] {
  const available = new Set(stepTypes);
  const builtIn = BUILT_IN_TEMPLATES.filter((t) => t.requires.every((r) => available.has(r)));
  const custom = stepTypes
    .filter((s) => !isBuiltInStep(s))
    .slice(0, 6)
    .flatMap<ChartTemplate>((s) => [
      { id: `custom-count-${s}`, question: tr("custom-chart-vocabulary.how_often_does_step_happen", { step: stepLabel(s, names) }), requires: [s], definition: def({ chartType: "line", stepTypes: [s], metric: "count" }) },
      { id: `custom-fail-${s}`, question: tr("custom-chart-vocabulary.how_often_does_step_fail", { step: stepLabel(s, names) }), requires: [s], definition: def({ chartType: "number", stepTypes: [s], metric: "error_rate" }) },
    ]);
  return [...builtIn, ...custom];
}
