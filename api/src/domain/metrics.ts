import type { TenantScope } from "@/domain/tenant";

export interface MetricsQuery {
  fromMs: number;
  toMs: number;
  /** Frontera de aislamiento (ADR-088): obligatoria, nunca construida a partir de la petición. */
  scope: TenantScope;
  bucketSeconds: number;
}

export interface OverviewTotals {
  /** trazas = spans raíz en el rango */
  traces: number;
  spans: number;
  /** conversaciones distintas con algún span en el rango */
  conversations: number;
  /** trazas cuyo span raíz falló (coincide con el filtro `status=error` del listado) */
  errorTraces: number;
  errorRate: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** 0 si ningún modelo usado tiene precio conocido, no "sin datos"; enriquecido por TraceQueryService (ADR-025) */
  costUsd: number;
}

export interface Latency {
  p50: number;
  p95: number;
  p99: number;
}

export interface TimeseriesPoint {
  bucketStartMs: number;
  traces: number;
  errorTraces: number;
  p95Ms: number;
  totalTokens: number;
}

export interface ModelUsage {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  p95Ms: number;
  /** null si no hay precio conocido para el modelo; enriquecido por TraceQueryService (ADR-025) */
  costUsd: number | null;
}

export interface ToolUsage {
  tool: string;
  calls: number;
  errors: number;
  p95Ms: number;
  /** servidor MCP que sirve la tool (`memtrace.mcp_server`); null si es una función local o el SDK no lo marca */
  mcpServer: string | null;
}

/** Distribución de temáticas de las respuestas del agente (ADR-022). */
export interface TopicUsage {
  topic: string;
  responses: number;
  avgConfidence: number;
}

/** Tokens totales de un experimento en un rango, para la comparativa de coste entre agentes. */
export interface ServiceUsage {
  experimentId: string;
  serviceName: string;
  traces: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface MetricsOverview {
  bucketSeconds: number;
  totals: OverviewTotals;
  latencyMs: Latency;
  timeseries: TimeseriesPoint[];
  byModel: ModelUsage[];
  byTool: ToolUsage[];
  /** vacío si el worker de temáticas (ADR-022) aún no ha corrido sobre este rango */
  byTopic: TopicUsage[];
}

const TARGET_BUCKETS = 60;
const MIN_BUCKET_SECONDS = 60;

/** ≈ 60 buckets por rango, múltiplo de 60 s y nunca menor de 60 s. */
export function chooseBucketSeconds(fromMs: number, toMs: number): number {
  const rangeSeconds = (toMs - fromMs) / 1000;
  const raw = Math.ceil(rangeSeconds / TARGET_BUCKETS);
  return Math.max(MIN_BUCKET_SECONDS, Math.ceil(raw / 60) * 60);
}

// ----- Custom metrics sobre spans definidos por el usuario (ADR-027) -----

export type CustomMetricType = "count" | "avg_duration" | "p50_duration" | "p95_duration" | "error_rate";
export type CustomChartType = "bar" | "pie" | "line" | "area" | "number" | "table";

export interface CustomMetricFilter {
  attribute: string;
  values: string[];
}

/** Definición declarativa de un gráfico custom: nunca SQL, solo estos campos cerrados (ADR-027). */
export interface CustomMetricDefinition {
  chartType: CustomChartType;
  /** `memtrace.step_type` de los spans a incluir (uno o varios) */
  stepTypes: string[];
  metric: CustomMetricType;
  /** restringe el dataset a estos valores de un atributo, antes de agregar */
  filters: CustomMetricFilter[];
  /** desglosa el resultado por los valores de este atributo, en vez de por step type */
  groupByAttribute: string | null;
}

export interface CustomMetricQuery extends CustomMetricDefinition {
  fromMs: number;
  toMs: number;
  /** Frontera de aislamiento (ADR-088): obligatoria, nunca construida a partir de la petición. */
  scope: TenantScope;
  /** solo para chartType "line": tamaño del bucket temporal */
  bucketSeconds?: number;
}

export interface CustomMetricPoint {
  label: string;
  value: number;
}

export interface CustomMetricBucket {
  bucketStartMs: number;
  points: CustomMetricPoint[];
}

/** `points`: agregado único (bar/pie/number). `timeseries`: solo cuando chartType es "line". */
export interface CustomMetricResult {
  points: CustomMetricPoint[];
  timeseries: CustomMetricBucket[];
}

export interface StepKindCount {
  stepType: string;
  count: number;
}

export interface AttributeValueCount {
  value: string;
  count: number;
}

/** Clave de atributo vista en `SpanAttributes`, para alimentar el selector de "group by"/"filter by" (ADR-030). */
export interface AttributeKeyCount {
  key: string;
  count: number;
}

/** Rellena con ceros los buckets sin datos para que el cliente pueda pintar la serie sin huecos. */
export function fillTimeseries(
  points: TimeseriesPoint[],
  fromMs: number,
  toMs: number,
  bucketSeconds: number,
): TimeseriesPoint[] {
  const bucketMs = bucketSeconds * 1000;
  const byBucket = new Map(points.map((p) => [p.bucketStartMs, p]));
  const filled: TimeseriesPoint[] = [];
  for (let t = Math.floor(fromMs / bucketMs) * bucketMs; t < toMs; t += bucketMs) {
    filled.push(byBucket.get(t) ?? { bucketStartMs: t, traces: 0, errorTraces: 0, p95Ms: 0, totalTokens: 0 });
  }
  return filled;
}
