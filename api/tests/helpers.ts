import type { TraceListQuery, TraceRepository, TraceSpans } from "@/application/ports/trace-repository";
import type { MetricsOverview, MetricsQuery } from "@/domain/metrics";
import type { Span } from "@/domain/span";
import type { TimeRange } from "@/domain/time-range";
import type { Page, TraceSummary } from "@/domain/trace";

let counter = 0;

export function span(overrides: Partial<Span> = {}): Span {
  counter += 1;
  return {
    spanId: `s${String(counter).padStart(4, "0")}`,
    parentSpanId: null,
    name: "step",
    serviceName: "svc",
    startTimeUs: 1_000_000 + counter,
    durationMs: 10,
    status: { code: "ok", message: null },
    attributes: {},
    events: [],
    ...overrides,
  };
}

export const emptyOverview: MetricsOverview = {
  bucketSeconds: 60,
  totals: { traces: 0, spans: 0, errorTraces: 0, errorRate: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  latencyMs: { p50: 0, p95: 0, p99: 0 },
  timeseries: [],
  byModel: [],
  byTool: [],
};

/** Repositorio en memoria: prueba servicio y HTTP sin ClickHouse. */
export class FakeTraceRepository implements TraceRepository {
  lastListQuery?: TraceListQuery;
  lastOverviewQuery?: MetricsQuery;
  page: Page<TraceSummary> = { items: [], nextCursor: null };
  traces = new Map<string, TraceSpans>();
  overview: MetricsOverview = emptyOverview;
  services: string[] = [];
  failWith?: Error;

  private check() {
    if (this.failWith) throw this.failWith;
  }
  async listTraces(query: TraceListQuery) {
    this.check();
    this.lastListQuery = query;
    return this.page;
  }
  async getTraceSpans(traceId: string) {
    this.check();
    return this.traces.get(traceId) ?? null;
  }
  async getOverview(query: MetricsQuery) {
    this.check();
    this.lastOverviewQuery = query;
    return this.overview;
  }
  async listServices(_range: TimeRange) {
    this.check();
    return this.services;
  }
  async ping() {
    this.check();
  }
}
