export interface MetricsQuery {
  fromMs: number;
  toMs: number;
  service?: string;
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
}

export interface ToolUsage {
  tool: string;
  calls: number;
  errors: number;
  p95Ms: number;
}

export interface MetricsOverview {
  bucketSeconds: number;
  totals: OverviewTotals;
  latencyMs: Latency;
  timeseries: TimeseriesPoint[];
  byModel: ModelUsage[];
  byTool: ToolUsage[];
}

const TARGET_BUCKETS = 60;
const MIN_BUCKET_SECONDS = 60;

/** ≈ 60 buckets por rango, múltiplo de 60 s y nunca menor de 60 s. */
export function chooseBucketSeconds(fromMs: number, toMs: number): number {
  const rangeSeconds = (toMs - fromMs) / 1000;
  const raw = Math.ceil(rangeSeconds / TARGET_BUCKETS);
  return Math.max(MIN_BUCKET_SECONDS, Math.ceil(raw / 60) * 60);
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
