import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { ConversationListQuery, SpanListQuery, TraceListQuery, TraceRepository, TraceSpans } from "@/application/ports/trace-repository";
import type { ConversationCursor, ConversationSummary } from "@/domain/conversation";
import { previewOf, type SpanCursor, type SpanRecord } from "@/domain/span-row";
import type { ChatSpanRecord } from "@/domain/transcript";
import type { MetricsOverview, MetricsQuery } from "@/domain/metrics";
import type { Span, StatusCode } from "@/domain/span";
import { MAX_RANGE_MS, type TimeRange } from "@/domain/time-range";
import type { Page, TraceSummary } from "@/domain/trace";
import { QueryLimiter } from "./query-limiter";

/** Los hijos de un span raíz pueden empezar después de que el rango termine: ventana de agregación. */
const TRACE_WINDOW_MS = 24 * 60 * 60 * 1000;

const ERROR = "'STATUS_CODE_ERROR'";
const OP = "SpanAttributes['gen_ai.operation.name']";
const attrNum = (key: string) => `toUInt64OrZero(SpanAttributes['${key}'])`;
/** Total reportado o, si falta el atributo, entrada + salida (misma regla que el dominio). */
const TOKENS = `if(mapContains(SpanAttributes, 'gen_ai.usage.total_tokens'), ${attrNum("gen_ai.usage.total_tokens")}, ${attrNum("gen_ai.usage.input_tokens")} + ${attrNum("gen_ai.usage.output_tokens")})`;

const attr = (key: string) => `SpanAttributes['${key}']`;
const CONTENT_KEYS = ["gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.tool.call.arguments", "gen_ai.tool.call.result", "memtrace.input", "memtrace.output"];
/** Tipo de paso: el declarado por el SDK o, si falta, el que se deduce de la operación GenAI. */
const KIND = `multiIf(${attr("memtrace.step_type")} != '', ${attr("memtrace.step_type")}, ${OP} = 'chat', 'llm', ${OP} = 'execute_tool', 'tool', 'unknown')`;
/** Primer atributo de contenido presente, acotado al máximo que guarda el SDK (16 KB). */
const firstOf = (keys: string[]) => `substring(multiIf(${keys.map((k) => `${attr(k)} != '', ${attr(k)}`).join(", ")}, ''), 1, 16384)`;

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

  async listSpans(q: SpanListQuery): Promise<Page<SpanRecord, SpanCursor>> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const where = [clause];
    const p: Params = { ...params, limit: q.limit + 1 };

    if (q.service) {
      where.push("ServiceName = {service:String}");
      p.service = q.service;
    }
    if (q.kind) {
      where.push(`${KIND} = {kind:String}`);
      p.kind = q.kind;
    }
    if (q.model) {
      where.push(`${attr("gen_ai.request.model")} = {model:String}`);
      p.model = q.model;
    }
    if (q.status) {
      where.push("StatusCode = {statusCode:String}");
      p.statusCode = q.status === "ok" ? "STATUS_CODE_OK" : "STATUS_CODE_ERROR";
    }
    if (q.conversationId) {
      where.push("ConversationId = {conversationId:String}");
      p.conversationId = q.conversationId;
    }
    if (q.text) {
      where.push(`(${CONTENT_KEYS.map((k) => `positionCaseInsensitiveUTF8(${attr(k)}, {text:String}) > 0`).join(" OR ")})`);
      p.text = q.text;
    }
    if (q.cursor) {
      where.push("(toUnixTimestamp64Micro(Timestamp), SpanId) < ({cursorUs:Int64}, {cursorSpanId:String})");
      p.cursorUs = q.cursor.startTimeUs;
      p.cursorSpanId = q.cursor.spanId;
    }

    const rows = await this.rows(
      `SELECT SpanId, TraceId, ParentSpanId, ConversationId, SpanName, ServiceName, toUnixTimestamp64Micro(Timestamp) AS startUs,
              Duration, StatusCode, ${KIND} AS kind, ${attr("gen_ai.request.model")} AS model, ${OP} = 'chat' AS isChat,
              if(${OP} = 'chat', ${TOKENS}, 0) AS tokens,
              ${firstOf(["gen_ai.input.messages", "gen_ai.tool.call.arguments", "memtrace.input"])} AS inputRaw,
              ${firstOf(["gen_ai.output.messages", "gen_ai.tool.call.result", "memtrace.output"])} AS outputRaw
       FROM ${this.spans} WHERE ${where.join(" AND ")}
       ORDER BY startUs DESC, SpanId DESC LIMIT {limit:UInt32}`,
      p,
    );

    const page = rows.slice(0, q.limit);
    const items: SpanRecord[] = page.map((r) => ({
      spanId: String(r.SpanId),
      traceId: String(r.TraceId),
      parentSpanId: r.ParentSpanId ? String(r.ParentSpanId) : null,
      conversationId: r.ConversationId ? String(r.ConversationId) : null,
      name: String(r.SpanName),
      kind: String(r.kind),
      serviceName: String(r.ServiceName),
      startTimeUs: num(r.startUs),
      durationMs: nsToMs(r.Duration),
      status: toStatus(r.StatusCode),
      model: r.model ? String(r.model) : null,
      totalTokens: r.isChat ? num(r.tokens) : null,
      inputRaw: r.inputRaw ? String(r.inputRaw) : null,
      outputRaw: r.outputRaw ? String(r.outputRaw) : null,
      chat: Boolean(r.isChat),
    }));
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > q.limit && last ? { startTimeUs: last.startTimeUs, spanId: last.spanId } : null };
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
    if (q.conversationId) {
      where.push("ConversationId = {conversationId:String}");
      p.conversationId = q.conversationId;
    }
    const dir = q.order === "asc" ? "ASC" : "DESC";
    if (q.cursor) {
      where.push(`(toUnixTimestamp64Micro(Timestamp), TraceId) ${dir === "ASC" ? ">" : "<"} ({cursorUs:Int64}, {cursorTraceId:String})`);
      p.cursorUs = q.cursor.startTimeUs;
      p.cursorTraceId = q.cursor.traceId;
    }

    const roots = await this.rows(
      `SELECT TraceId, SpanName, ServiceName, ConversationId, toUnixTimestamp64Micro(Timestamp) AS startUs, Duration, StatusCode
       FROM ${this.spans} WHERE ${where.join(" AND ")}
       ORDER BY startUs ${dir}, TraceId ${dir} LIMIT {limit:UInt32}`,
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
        input: agg ? previewOf(agg.inputRaw, "input", agg.inputChat) : null,
        output: agg ? previewOf(agg.outputRaw, "output", agg.outputChat) : null,
        conversationId: r.ConversationId ? String(r.ConversationId) : null,
      };
    });

    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? { startTimeUs: last.startTimeUs, traceId: last.traceId } : null };
  }

  /** Agregados por traza para una página, acotados en tiempo para podar particiones diarias. */
  private async aggregatesFor(roots: Row[]) {
    const result = new Map<string, { spanCount: number; errorCount: number; totalTokens: number; inputRaw: string | null; inputChat: boolean; outputRaw: string | null; outputChat: boolean }>();
    if (roots.length === 0) return result;

    const startsMs = roots.map((r) => num(r.startUs) / 1000);
    const fromMs = Math.floor(Math.min(...startsMs));
    const toMs = Math.ceil(Math.max(...startsMs)) + TRACE_WINDOW_MS;
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);

    // Entrada = la del primer span que la tiene; salida = la del último en terminar.
    const inputExpr = firstOf(["memtrace.input", "gen_ai.input.messages", "gen_ai.tool.call.arguments"]);
    const outputExpr = firstOf(["memtrace.output", "gen_ai.output.messages", "gen_ai.tool.call.result"]);
    const rows = await this.rows(
      `SELECT TraceId, uniqExact(SpanId) AS spanCount, uniqExactIf(SpanId, StatusCode = ${ERROR}) AS errorCount,
              sumIf(${TOKENS}, ${OP} = 'chat') AS totalTokens,
              argMinIf(${inputExpr}, Timestamp, ${inputExpr} != '') AS inputRaw,
              argMinIf(${OP} = 'chat', Timestamp, ${inputExpr} != '') AS inputChat,
              argMaxIf(${outputExpr}, Timestamp + toIntervalNanosecond(Duration), ${outputExpr} != '') AS outputRaw,
              argMaxIf(${OP} = 'chat', Timestamp + toIntervalNanosecond(Duration), ${outputExpr} != '') AS outputChat
       FROM ${this.spans} WHERE TraceId IN {ids:Array(String)} AND ${clause} GROUP BY TraceId`,
      { ...params, ids: roots.map((r) => String(r.TraceId)) },
    );
    for (const r of rows) {
      result.set(String(r.TraceId), {
        spanCount: num(r.spanCount),
        errorCount: num(r.errorCount),
        totalTokens: num(r.totalTokens),
        inputRaw: r.inputRaw ? String(r.inputRaw) : null,
        inputChat: Boolean(r.inputChat),
        outputRaw: r.outputRaw ? String(r.outputRaw) : null,
        outputChat: Boolean(r.outputChat),
      });
    }
    return result;
  }

  async listConversations(q: ConversationListQuery): Promise<Page<ConversationSummary, ConversationCursor>> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const where = ["ParentSpanId = ''", "ConversationId != ''", clause];
    const p: Params = { ...params, limit: q.limit + 1 };

    if (q.service) {
      where.push("ServiceName = {service:String}");
      p.service = q.service;
    }
    if (q.hasErrors) {
      where.push(
        `ConversationId IN (SELECT ConversationId FROM ${this.spans} WHERE ConversationId != '' AND StatusCode = ${ERROR} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`,
      );
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    const having = q.cursor ? "HAVING (lastUs, ConversationId) < ({cursorUs:Int64}, {cursorId:String})" : "";
    if (q.cursor) {
      p.cursorUs = q.cursor.lastActivityUs;
      p.cursorId = q.cursor.conversationId;
    }

    // 1) qué conversaciones (por su última actividad dentro del rango)
    const found = await this.rows(
      `SELECT ConversationId, max(toUnixTimestamp64Micro(Timestamp)) AS lastUs
       FROM ${this.spans} WHERE ${where.join(" AND ")}
       GROUP BY ConversationId ${having}
       ORDER BY lastUs DESC, ConversationId DESC LIMIT {limit:UInt32}`,
      p,
    );
    const hasMore = found.length > q.limit;
    const page = found.slice(0, q.limit).map((r) => String(r.ConversationId));

    // 2) sus cifras, sobre toda la historia retenida
    const summaries = await this.conversationSummaries(page, q.toMs);
    const items = page.map((id) => summaries.get(id)).filter((s): s is ConversationSummary => s !== undefined);
    const lastRow = found[q.limit - 1];
    return {
      items,
      nextCursor: hasMore && lastRow ? { lastActivityUs: num(lastRow.lastUs), conversationId: String(lastRow.ConversationId) } : null,
    };
  }

  async getConversation(conversationId: string, range: TimeRange): Promise<ConversationSummary | null> {
    const found = await this.conversationSummaries([conversationId], range.toMs);
    return found.get(conversationId) ?? null;
  }

  /** Cifras por conversación en una sola pasada sobre la columna `ConversationId` (ADR-012). */
  private async conversationSummaries(ids: string[], toMs: number): Promise<Map<string, ConversationSummary>> {
    const result = new Map<string, ConversationSummary>();
    if (ids.length === 0) return result;
    const { clause, params } = ClickHouseTraceRepository.range(toMs - MAX_RANGE_MS, toMs + TRACE_WINDOW_MS);

    const rows = await this.rows(
      `SELECT ConversationId,
              groupUniqArray(10)(ServiceName) AS services,
              uniqExactIf(TraceId, ParentSpanId = '') AS turns,
              min(toUnixTimestamp64Micro(Timestamp)) AS firstUs,
              maxIf(toUnixTimestamp64Micro(Timestamp) + intDiv(Duration, 1000), ParentSpanId = '') AS lastEndUs,
              countIf(ParentSpanId = '' AND StatusCode = ${ERROR}) AS errorTurns,
              uniqExactIf(SpanId, StatusCode = ${ERROR}) AS failedSpans,
              sumIf(${TOKENS}, ${OP} = 'chat') AS totalTokens,
              sumIf(Duration, ParentSpanId = '') AS activeNs
       FROM ${this.spans} WHERE ConversationId IN {ids:Array(String)} AND ${clause} GROUP BY ConversationId`,
      { ...params, ids },
    );
    for (const r of rows) {
      const id = String(r.ConversationId);
      result.set(id, {
        conversationId: id,
        serviceNames: ((r.services as string[]) ?? []).slice().sort(),
        startTimeUs: num(r.firstUs),
        lastActivityUs: num(r.lastEndUs),
        turnCount: num(r.turns),
        errorTurns: num(r.errorTurns),
        failedSpans: num(r.failedSpans),
        totalTokens: num(r.totalTokens),
        activeMs: nsToMs(r.activeNs),
      });
    }
    return result;
  }

  async getConversationMessages(conversationId: string, range: TimeRange, maxSpans: number): Promise<{ records: ChatSpanRecord[]; truncated: boolean }> {
    const { clause, params } = ClickHouseTraceRepository.range(range.toMs - MAX_RANGE_MS, range.toMs + TRACE_WINDOW_MS);
    const rows = await this.rows(
      `SELECT TraceId, toUnixTimestamp64Micro(Timestamp) AS startUs,
              SpanAttributes['gen_ai.request.model'] AS model,
              SpanAttributes['gen_ai.input.messages'] AS input,
              SpanAttributes['gen_ai.output.messages'] AS output
       FROM ${this.spans}
       WHERE ConversationId = {conversationId:String} AND ${OP} = 'chat' AND ${clause}
       ORDER BY Timestamp ASC LIMIT {limit:UInt32}`,
      { ...params, conversationId, limit: maxSpans + 1 },
    );
    return {
      records: rows.slice(0, maxSpans).map((r) => ({
        traceId: String(r.TraceId),
        startTimeUs: num(r.startUs),
        model: r.model ? String(r.model) : null,
        inputMessages: r.input ? String(r.input) : null,
        outputMessages: r.output ? String(r.output) : null,
      })),
      truncated: rows.length > maxSpans,
    };
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
        `SELECT count() AS spans, uniqExactIf(ConversationId, ConversationId != '') AS conversations, sumIf(${attrNum("gen_ai.usage.input_tokens")}, ${OP} = 'chat') AS inputTokens,
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
        conversations: num(s.conversations),
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
