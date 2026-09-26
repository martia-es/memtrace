import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { TraceListQuery, TraceRepository, TraceSpans } from "@/application/ports/trace-repository";
import type { MetricsOverview, MetricsQuery } from "@/domain/metrics";
import type { Span, StatusCode } from "@/domain/span";
import type { TimeRange } from "@/domain/time-range";
import type { Page, TraceSummary } from "@/domain/trace";
import { QueryLimiter } from "./query-limiter";

/** Los hijos de un span raíz pueden empezar después de que el rango termine: ventana de agregación. */
const TRACE_WINDOW_MS = 24 * 60 * 60 * 1000;

const ERROR = "'STATUS_CODE_ERROR'";
const OP = "SpanAttributes['gen_ai.operation.name']";
const attrNum = (key: string) => `toUInt64OrZero(SpanAttributes['${key}'])`;
/** Total reportado o, si falta el atributo, entrada + salida (misma regla que el dominio). */
const TOKENS = `if(mapContains(SpanAttributes, 'gen_ai.usage.total_tokens'), ${attrNum("gen_ai.usage.total_tokens")}, ${attrNum("gen_ai.usage.input_tokens")} + ${attrNum("gen_ai.usage.output_tokens")})`;

type Row = Record<string, unknown>;
type Params = Record<string, string | number | string[]>;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const nsToMs = (value: unknown): number => num(value) / 1e6;

function toStatus(code: unknown): StatusCode {
  if (code === "STATUS_CODE_OK") return "ok";
  if (code === "STATUS_CODE_ERROR") return "error";
  return "unset";
}

/** Implementación del puerto sobre la tabla `otel_traces` (ADR-003). Todas las consultas van parametrizadas. */
export class ClickHouseTraceRepository implements TraceRepository {
  private readonly spans: string;
  private readonly traceIndex: string;

  private readonly limiter: QueryLimiter;

  constructor(
    private readonly client: ClickHouseClient,
    database = "memtrace",
    maxConcurrentQueries = 3,
  ) {
    this.limiter = new QueryLimiter(maxConcurrentQueries);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error(`Invalid database name: ${database}`);
    this.spans = `${database}.otel_traces`;
    this.traceIndex = `${database}.otel_traces_trace_id_ts`;
  }

  private async rows<T = Row>(query: string, params: Params): Promise<T[]> {
    try {
      return await this.limiter.run(async () => {
        const result = await this.client.query({ query, query_params: params, format: "JSONEachRow" });
        return await result.json<T>();
      });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  private static range(fromMs: number, toMs: number) {
    return {
      clause: "Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toMs:Int64})",
      params: { fromMs, toMs } as Params,
    };
  }

  async ping(): Promise<void> {
    try {
      const result = await this.client.ping();
      if (!result.success) throw result.error;
    } catch (error) {
      throw new RepositoryUnavailableError(error);
    }
  }

  async listServices({ fromMs, toMs }: TimeRange): Promise<string[]> {
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);
    const rows = await this.rows<{ ServiceName: string }>(
      `SELECT DISTINCT ServiceName FROM ${this.spans} WHERE ${clause} ORDER BY ServiceName LIMIT 1000`,
      params,
    );
    return rows.map((r) => r.ServiceName);
  }

  async listTraces(q: TraceListQuery): Promise<Page<TraceSummary>> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const where = ["ParentSpanId = ''", clause];
    const p: Params = { ...params, limit: q.limit + 1 };

    if (q.service) {
      where.push("ServiceName = {service:String}");
      p.service = q.service;
    }
    if (q.status) {
      where.push("StatusCode = {statusCode:String}");
      p.statusCode = q.status === "ok" ? "STATUS_CODE_OK" : "STATUS_CODE_ERROR";
    }
    if (q.minDurationMs !== undefined) {
      where.push("Duration >= {minDurationNs:UInt64}");
      p.minDurationNs = Math.round(q.minDurationMs * 1e6);
    }
    if (q.hasErrors) {
      where.push(
        `TraceId IN (SELECT TraceId FROM ${this.spans} WHERE StatusCode = ${ERROR} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`,
      );
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    if (q.cursor) {
      where.push("(toUnixTimestamp64Micro(Timestamp), TraceId) < ({cursorUs:Int64}, {cursorTraceId:String})");
      p.cursorUs = q.cursor.startTimeUs;
      p.cursorTraceId = q.cursor.traceId;
    }

    const roots = await this.rows(
      `SELECT TraceId, SpanName, ServiceName, toUnixTimestamp64Micro(Timestamp) AS startUs, Duration, StatusCode
       FROM ${this.spans} WHERE ${where.join(" AND ")}
       ORDER BY startUs DESC, TraceId DESC LIMIT {limit:UInt32}`,
      p,
    );

    const hasMore = roots.length > q.limit;
    const page = roots.slice(0, q.limit);
    const aggregates = await this.aggregatesFor(page);

    const items: TraceSummary[] = page.map((r) => {
      const agg = aggregates.get(String(r.TraceId));
      return {
        traceId: String(r.TraceId),
        rootSpanName: String(r.SpanName),
        serviceName: String(r.ServiceName),
        startTimeUs: num(r.startUs),
        durationMs: nsToMs(r.Duration),
        status: toStatus(r.StatusCode),
        spanCount: agg?.spanCount ?? 1,
        errorCount: agg?.errorCount ?? 0,
        totalTokens: agg?.totalTokens ?? 0,
      };
    });

    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? { startTimeUs: last.startTimeUs, traceId: last.traceId } : null };
  }

  /** Agregados por traza para una página, acotados en tiempo para podar particiones diarias. */
  private async aggregatesFor(roots: Row[]) {
    const result = new Map<string, { spanCount: number; errorCount: number; totalTokens: number }>();
    if (roots.length === 0) return result;

    const startsMs = roots.map((r) => num(r.startUs) / 1000);
    const fromMs = Math.floor(Math.min(...startsMs));
    const toMs = Math.ceil(Math.max(...startsMs)) + TRACE_WINDOW_MS;
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);

    const rows = await this.rows(
      `SELECT TraceId, uniqExact(SpanId) AS spanCount, uniqExactIf(SpanId, StatusCode = ${ERROR}) AS errorCount,
              sumIf(${TOKENS}, ${OP} = 'chat') AS totalTokens
       FROM ${this.spans} WHERE TraceId IN {ids:Array(String)} AND ${clause} GROUP BY TraceId`,
      { ...params, ids: roots.map((r) => String(r.TraceId)) },
    );
    for (const r of rows) {
      result.set(String(r.TraceId), {
        spanCount: num(r.spanCount),
        errorCount: num(r.errorCount),
        totalTokens: num(r.totalTokens),
      });
    }
    return result;
  }

  async getTraceSpans(traceId: string, maxSpans: number): Promise<TraceSpans | null> {
    // El índice se alimenta por bloque de inserción: una traza puede tener varias filas
    const [bounds] = await this.rows(
      `SELECT count() AS n, toUnixTimestamp64Micro(min(Start)) AS startUs, toUnixTimestamp64Micro(max(End)) AS endUs
       FROM ${this.traceIndex} WHERE TraceId = {traceId:String}`,
      { traceId },
    );
    if (!bounds || num(bounds.n) === 0) return null;

    const rows = await this.rows(
      `SELECT SpanId, ParentSpanId, SpanName, ServiceName, toUnixTimestamp64Micro(Timestamp) AS startUs,
              Duration, StatusCode, StatusMessage, SpanAttributes,
              \`Events.Name\` AS evName, \`Events.Attributes\` AS evAttrs,
              arrayMap(t -> toUnixTimestamp64Micro(t), \`Events.Timestamp\`) AS evTs
       FROM ${this.spans}
       WHERE TraceId = {traceId:String}
         AND Timestamp >= fromUnixTimestamp64Micro({startUs:Int64}) AND Timestamp <= fromUnixTimestamp64Micro({endUs:Int64})
       ORDER BY Timestamp ASC LIMIT {limit:UInt32}`,
      { traceId, startUs: num(bounds.startUs), endUs: num(bounds.endUs), limit: maxSpans + 1 },
    );

    const spans: Span[] = rows.slice(0, maxSpans).map((r) => {
      const evName = (r.evName as string[]) ?? [];
      const evAttrs = (r.evAttrs as Record<string, string>[]) ?? [];
      const evTs = (r.evTs as unknown[]) ?? [];
      return {
        spanId: String(r.SpanId),
        parentSpanId: r.ParentSpanId ? String(r.ParentSpanId) : null,
        name: String(r.SpanName),
        serviceName: String(r.ServiceName),
        startTimeUs: num(r.startUs),
        durationMs: nsToMs(r.Duration),
        status: { code: toStatus(r.StatusCode), message: r.StatusMessage ? String(r.StatusMessage) : null },
        attributes: (r.SpanAttributes as Record<string, string>) ?? {},
        events: evName.map((name, i) => ({ name, timeUs: num(evTs[i]), attributes: evAttrs[i] ?? {} })),
      };
    });
    return { spans, truncated: rows.length > maxSpans };
  }

  async getOverview(q: MetricsQuery): Promise<MetricsOverview> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const svc = q.service ? " AND ServiceName = {service:String}" : "";
    const p: Params = { ...params, bucket: q.bucketSeconds, ...(q.service ? { service: q.service } : {}) };
    const from = `FROM ${this.spans} WHERE ${clause}${svc}`;
    const bucket = "intDiv(toUnixTimestamp(Timestamp), {bucket:UInt32}) * {bucket:UInt32}";

    const [totals, spanTotals, series, tokenSeries, models, tools] = await Promise.all([
      this.rows(
        `SELECT count() AS traces, countIf(StatusCode = ${ERROR}) AS errorTraces,
                quantiles(0.5, 0.95, 0.99)(Duration) AS q ${from} AND ParentSpanId = ''`,
        p,
      ),
      this.rows(
        `SELECT count() AS spans, sumIf(${attrNum("gen_ai.usage.input_tokens")}, ${OP} = 'chat') AS inputTokens,
                sumIf(${attrNum("gen_ai.usage.output_tokens")}, ${OP} = 'chat') AS outputTokens,
                sumIf(${TOKENS}, ${OP} = 'chat') AS totalTokens ${from}`,
        p,
      ),
      this.rows(
        `SELECT ${bucket} AS bucket, count() AS traces, countIf(StatusCode = ${ERROR}) AS errorTraces,
                quantile(0.95)(Duration) AS p95 ${from} AND ParentSpanId = '' GROUP BY bucket ORDER BY bucket`,
        p,
      ),
      this.rows(
        `SELECT ${bucket} AS bucket, sum(${TOKENS}) AS tokens ${from} AND ${OP} = 'chat' GROUP BY bucket`,
        p,
      ),
      this.rows(
        `SELECT SpanAttributes['gen_ai.request.model'] AS model, count() AS calls,
                sum(${attrNum("gen_ai.usage.input_tokens")}) AS inputTokens, sum(${attrNum("gen_ai.usage.output_tokens")}) AS outputTokens,
                quantile(0.95)(Duration) AS p95 ${from} AND ${OP} = 'chat' GROUP BY model ORDER BY calls DESC LIMIT 50`,
        p,
      ),
      this.rows(
        `SELECT if(SpanAttributes['gen_ai.tool.name'] != '', SpanAttributes['gen_ai.tool.name'], SpanName) AS tool,
                count() AS calls, countIf(StatusCode = ${ERROR}) AS errors, quantile(0.95)(Duration) AS p95
         ${from} AND ${OP} = 'execute_tool' GROUP BY tool ORDER BY calls DESC LIMIT 50`,
        p,
      ),
    ]);

    const t = totals[0] ?? {};
    const quantiles = (t.q as unknown[]) ?? [];
    const traces = num(t.traces);
    const errorTraces = num(t.errorTraces);
    const tokensByBucket = new Map(tokenSeries.map((r) => [num(r.bucket), num(r.tokens)]));
    const timeseries = series.map((r) => ({
      bucketStartMs: num(r.bucket) * 1000,
      traces: num(r.traces),
      errorTraces: num(r.errorTraces),
      p95Ms: nsToMs(r.p95),
      totalTokens: tokensByBucket.get(num(r.bucket)) ?? 0,
    }));
    // buckets con tokens pero sin ningún span raíz (raíz fuera del rango)
    const seen = new Set(timeseries.map((x) => x.bucketStartMs));
    for (const [b, tokens] of tokensByBucket) {
      if (!seen.has(b * 1000)) timeseries.push({ bucketStartMs: b * 1000, traces: 0, errorTraces: 0, p95Ms: 0, totalTokens: tokens });
    }
    timeseries.sort((a, b) => a.bucketStartMs - b.bucketStartMs);

    const s = spanTotals[0] ?? {};
    return {
      bucketSeconds: q.bucketSeconds,
      totals: {
        traces,
        spans: num(s.spans),
        errorTraces,
        errorRate: traces > 0 ? errorTraces / traces : 0,
        inputTokens: num(s.inputTokens),
        outputTokens: num(s.outputTokens),
        totalTokens: num(s.totalTokens),
      },
      latencyMs: { p50: nsToMs(quantiles[0]), p95: nsToMs(quantiles[1]), p99: nsToMs(quantiles[2]) },
      timeseries,
      byModel: models.map((r) => ({
        model: String(r.model || "unknown"),
        calls: num(r.calls),
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        p95Ms: nsToMs(r.p95),
      })),
      byTool: tools.map((r) => ({
        tool: String(r.tool),
        calls: num(r.calls),
        errors: num(r.errors),
        p95Ms: nsToMs(r.p95),
      })),
    };
  }
}
