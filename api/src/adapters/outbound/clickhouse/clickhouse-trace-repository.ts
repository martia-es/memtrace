import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { ConversationListQuery, RevisionSummary, SpanListQuery, TraceListQuery, TraceRepository, TraceSpans } from "@/application/ports/trace-repository";
import type { ErrorGroupsResult } from "@/domain/error-categories";
import type { ConversationCursor, ConversationSummary, ConversationUsage } from "@/domain/conversation";
import type { ModelPricing } from "@/domain/pricing";
import { previewOf, type SpanCursor, type SpanRecord } from "@/domain/span-row";
import type { ChatSpanRecord } from "@/domain/transcript";
import type { AttributeKeyCount, AttributeValueCount, CustomMetricQuery, CustomMetricResult, MetricsOverview, MetricsQuery, ServiceUsage, StepKindCount } from "@/domain/metrics";
import type { Span, StatusCode } from "@/domain/span";
import { MAX_RANGE_MS, type TimeRange } from "@/domain/time-range";
import type { PromptRef, Page, TraceStats, TraceSummary } from "@/domain/trace";
import type { TenantScope } from "@/domain/tenant";
import { QueryLimiter } from "./query-limiter";
import { TENANT_SQL, tenantParams, tenantSqlFor } from "./tenant-sql";

/** Los hijos de un span raíz pueden empezar después de que el rango termine: ventana de agregación. */
export const TRACE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const ERROR = "'STATUS_CODE_ERROR'";
export const OP = "SpanAttributes['gen_ai.operation.name']";
export const attrNum = (key: string) => `toUInt64OrZero(SpanAttributes['${key}'])`;
/** Total reportado o, si falta el atributo, entrada + salida (misma regla que el dominio). */
const TOKENS = `if(mapContains(SpanAttributes, 'gen_ai.usage.total_tokens'), ${attrNum("gen_ai.usage.total_tokens")}, ${attrNum("gen_ai.usage.input_tokens")} + ${attrNum("gen_ai.usage.output_tokens")})`;

export const attr = (key: string) => `SpanAttributes['${key}']`;
const CONTENT_KEYS = ["gen_ai.input.messages", "gen_ai.output.messages", "gen_ai.tool.call.arguments", "gen_ai.tool.call.result", "memtrace.input", "memtrace.output"];
/** el parámetro `{text}` aparece (sin distinguir mayúsculas) en la entrada o salida capturadas del span */
const CONTENT_MATCH = `(${CONTENT_KEYS.map((k) => `positionCaseInsensitiveUTF8(${attr(k)}, {text:String}) > 0`).join(" OR ")})`;
/** Tipo de paso: el declarado por el SDK o, si falta, el que se deduce de la operación GenAI. */
export const KIND = `multiIf(${attr("memtrace.step_type")} != '', ${attr("memtrace.step_type")}, ${OP} = 'chat', 'llm', ${OP} = 'execute_tool', 'tool', 'unknown')`;
/** Primer atributo de contenido presente, acotado al máximo que guarda el SDK (16 KB). */
const firstOf = (keys: string[]) => `substring(multiIf(${keys.map((k) => `${attr(k)} != '', ${attr(k)}`).join(", ")}, ''), 1, 16384)`;

type Row = Record<string, unknown>;
type Params = Record<string, string | number | string[]>;

export const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const nsToMs = (value: unknown): number => num(value) / 1e6;

function toStatus(code: unknown): StatusCode {
  if (code === "STATUS_CODE_OK") return "ok";
  if (code === "STATUS_CODE_ERROR") return "error";
  return "unset";
}

/** Implementación del puerto sobre la tabla `otel_traces` (ADR-003). Todas las consultas van parametrizadas. */
/** `groupUniqArray((PromptName, PromptVersion))` llega como pares [nombre, versión]; la versión más alta primero. */
function promptRefs(raw: unknown): PromptRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((pair) => ({ name: String((pair as unknown[])[0]), version: Number((pair as unknown[])[1]) }))
    .filter((p) => p.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name) || b.version - a.version);
}

export class ClickHouseTraceRepository implements TraceRepository {
  private readonly spans: string;
  private readonly traceIndex: string;
  private readonly topics: string;
  private readonly pricing: string;

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
    this.topics = `${database}.span_topics`;
    this.pricing = `${database}.model_pricing`;
  }

  /** Catálogo de precios vigente (ADR-025): `FINAL` fuerza la deduplicación de `ReplacingMergeTree` en la lectura. */
  async getModelPricing(): Promise<ModelPricing[]> {
    const rows = await this.rows<{ ModelId: string; Provider: string; InputPricePerToken: number; OutputPricePerToken: number; Source: string; updatedAtMs: number }>(
      `SELECT ModelId, Provider, InputPricePerToken, OutputPricePerToken, Source, toUnixTimestamp64Milli(UpdatedAt) AS updatedAtMs
       FROM ${this.pricing} FINAL ORDER BY ModelId`,
      {},
    );
    return rows.map((r) => ({
      modelId: r.ModelId,
      provider: r.Provider,
      inputPricePerToken: num(r.InputPricePerToken),
      outputPricePerToken: num(r.OutputPricePerToken),
      source: r.Source,
      updatedAtMs: num(r.updatedAtMs),
    }));
  }

  /** `memtrace.step_type` distintos vistos en el rango, con conteo (ADR-027). */
  async getStepKinds(query: TimeRange & { scope: TenantScope }): Promise<StepKindCount[]> {
    const { clause, params } = ClickHouseTraceRepository.range(query.fromMs, query.toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const p: Params = { ...params, ...tenantParams(query.scope) };
    const rows = await this.rows<{ stepType: string; count: number }>(
      `SELECT ${KIND} AS stepType, count() AS count FROM ${this.spans} WHERE ${clause}${svc} GROUP BY stepType ORDER BY count DESC LIMIT 200`,
      p,
    );
    return rows.map((r) => ({ stepType: r.stepType, count: num(r.count) }));
  }

  /** Valores distintos de un atributo, acotados a los step types dados (ADR-027): alimenta filtro/agrupación dinámicos. */
  async getAttributeValues(query: TimeRange & { scope: TenantScope; stepTypes: string[]; attribute: string }): Promise<AttributeValueCount[]> {
    const { clause, params } = ClickHouseTraceRepository.range(query.fromMs, query.toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const p: Params = {
      ...params,
      attribute: query.attribute,
      stepTypes: query.stepTypes,
      ...tenantParams(query.scope),
    };
    const rows = await this.rows<{ value: string; count: number }>(
      `SELECT SpanAttributes[{attribute:String}] AS value, count() AS count FROM ${this.spans}
       WHERE ${clause}${svc} AND ${KIND} IN {stepTypes:Array(String)} AND SpanAttributes[{attribute:String}] != ''
       GROUP BY value ORDER BY count DESC LIMIT 200`,
      p,
    );
    return rows.map((r) => ({ value: r.value, count: num(r.count) }));
  }

  /** Claves de `SpanAttributes` vistas en los step types dados, para los selectores de "group by"/"filter by" (ADR-030). */
  async getAttributeKeys(query: TimeRange & { scope: TenantScope; stepTypes: string[] }): Promise<AttributeKeyCount[]> {
    const { clause, params } = ClickHouseTraceRepository.range(query.fromMs, query.toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const p: Params = { ...params, stepTypes: query.stepTypes, ...tenantParams(query.scope) };
    const rows = await this.rows<{ key: string; count: number }>(
      `SELECT arrayJoin(mapKeys(SpanAttributes)) AS key, count() AS count FROM ${this.spans}
       WHERE ${clause}${svc} AND ${KIND} IN {stepTypes:Array(String)}
       GROUP BY key ORDER BY count DESC LIMIT 200`,
      p,
    );
    return rows.map((r) => ({ key: r.key, count: num(r.count) }));
  }

  /**
   * Calcula un gráfico custom (ADR-027/030). `metric`/`chartType` son un enum cerrado elegido por el
   * servidor; `filters`/`groupByAttribute` son siempre parámetros ligados, nunca concatenados al SQL.
   */
  async listErrorGroups({ fromMs, toMs, scope }: TimeRange & { scope: TenantScope }): Promise<ErrorGroupsResult> {
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const p: Params = { ...params, ...tenantParams(scope) };
    const base = `FROM ${this.spans} WHERE ${clause}${svc}`;
    const failed = `${base} AND StatusCode = ${ERROR}`;
    // solo el fallo más profundo: un span cuyo hijo también falla es una propagación del mismo error
    const leaf = `${failed} AND (TraceId, SpanId) NOT IN (SELECT TraceId, ParentSpanId ${failed} AND ParentSpanId != '')`;
    const exceptionAttr = (key: string) => `arrayElement(arrayMap(a -> a['${key}'], \`Events.Attributes\`), indexOf(\`Events.Name\`, 'exception'))`;

    const [groups, failedTotals, totals] = await Promise.all([
      this.rows(
        `SELECT ${KIND} AS kind, multiIf(${attr("gen_ai.tool.name")} != '', ${attr("gen_ai.tool.name")}, ${attr("gen_ai.request.model")} != '', ${attr("gen_ai.request.model")}, SpanName) AS errName,
                substring(StatusMessage, 1, 300) AS message, ${exceptionAttr("exception.type")} AS exceptionType, substring(${exceptionAttr("exception.message")}, 1, 300) AS exceptionMessage,
                count() AS occurrences, uniqExact(TraceId) AS traces, uniqExactIf(ConversationId, ConversationId != '') AS conversations,
                toUnixTimestamp64Milli(min(Timestamp)) AS firstMs, toUnixTimestamp64Milli(max(Timestamp)) AS lastMs
         ${leaf} GROUP BY kind, errName, message, exceptionType, exceptionMessage ORDER BY occurrences DESC LIMIT 500`,
        p,
      ),
      this.rows(`SELECT uniqExact(TraceId) AS traces, uniqExactIf(ConversationId, ConversationId != '') AS conversations ${failed}`, p),
      this.rows(`SELECT uniqExact(TraceId) AS traces, uniqExactIf(ConversationId, ConversationId != '') AS conversations ${base}`, p),
    ]);
    return {
      groups: groups.map((r) => ({
        kind: String(r.kind),
        name: String(r.errName),
        message: String(r.message),
        exceptionType: String(r.exceptionType ?? ""),
        exceptionMessage: String(r.exceptionMessage ?? ""),
        occurrences: num(r.occurrences),
        traces: num(r.traces),
        conversations: num(r.conversations),
        firstSeenMs: num(r.firstMs),
        lastSeenMs: num(r.lastMs),
      })),
      tracesWithErrors: num(failedTotals[0]?.traces),
      conversationsWithErrors: num(failedTotals[0]?.conversations),
      totalTraces: num(totals[0]?.traces),
      totalConversations: num(totals[0]?.conversations),
    };
  }

  async getCustomMetric(q: CustomMetricQuery): Promise<CustomMetricResult> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const p: Params = { ...params, stepTypes: q.stepTypes, ...tenantParams(q.scope) };

    const filterClauses = q.filters.map((f, i) => {
      p[`filterAttr${i}`] = f.attribute;
      p[`filterVals${i}`] = f.values;
      return ` AND SpanAttributes[{filterAttr${i}:String}] IN {filterVals${i}:Array(String)}`;
    });

    const metricExpr =
      q.metric === "avg_duration"
        ? "avg(Duration) / 1e6"
        : q.metric === "p50_duration"
          ? "quantile(0.5)(Duration) / 1e6"
          : q.metric === "p95_duration"
            ? "quantile(0.95)(Duration) / 1e6"
            : q.metric === "error_rate"
              ? `countIf(StatusCode = ${ERROR}) / count()`
              : "count()";

    let labelExpr = KIND;
    let extraWhere = "";
    if (q.groupByAttribute) {
      p.groupBy = q.groupByAttribute;
      labelExpr = "SpanAttributes[{groupBy:String}]";
      extraWhere = " AND SpanAttributes[{groupBy:String}] != ''";
    }

    const where = `WHERE ${clause}${svc} AND ${KIND} IN {stepTypes:Array(String)}${filterClauses.join("")}${extraWhere}`;

    if (q.chartType === "line" || q.chartType === "area") {
      p.bucket = q.bucketSeconds ?? 3600;
      const rows = await this.rows<{ bucket: number; label: string; value: number }>(
        `SELECT intDiv(toUnixTimestamp(Timestamp), {bucket:UInt32}) * {bucket:UInt32} AS bucket, ${labelExpr} AS label, ${metricExpr} AS value
         FROM ${this.spans} ${where} GROUP BY bucket, label ORDER BY bucket, label`,
        p,
      );
      const byBucket = new Map<number, { label: string; value: number }[]>();
      for (const r of rows) {
        const bucketMs = num(r.bucket) * 1000;
        const list = byBucket.get(bucketMs) ?? [];
        list.push({ label: r.label, value: num(r.value) });
        byBucket.set(bucketMs, list);
      }
      const timeseries = [...byBucket.entries()]
        .map(([bucketStartMs, points]) => ({ bucketStartMs, points }))
        .sort((a, b) => a.bucketStartMs - b.bucketStartMs);
      return { points: [], timeseries };
    }

    const rows = await this.rows<{ label: string; value: number }>(
      `SELECT ${labelExpr} AS label, ${metricExpr} AS value FROM ${this.spans} ${where} GROUP BY label ORDER BY value DESC LIMIT 50`,
      p,
    );
    return { points: rows.map((r) => ({ label: r.label, value: num(r.value) })), timeseries: [] };
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

  async listRevisions({ fromMs, toMs, scope }: TimeRange & { scope: TenantScope }): Promise<RevisionSummary[]> {
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const rows = await this.rows(
      `SELECT Revision, uniqExact(TraceId) AS traces, toUnixTimestamp64Milli(max(Timestamp)) AS lastMs
       FROM ${this.spans} WHERE ParentSpanId = '' AND Revision != '' AND ${clause}${svc}
       GROUP BY Revision ORDER BY lastMs DESC LIMIT 50`,
      { ...params, ...tenantParams(scope) },
    );
    return rows.map((r) => ({ revision: String(r.Revision), traces: num(r.traces), lastSeenMs: num(r.lastMs) }));
  }

  /** Nombres de servicio con datos en el rango, **solo** de los experimentos dados (los que la persona puede leer). */
  async listServices({ fromMs, toMs }: TimeRange, scopes: TenantScope[]): Promise<string[]> {
    if (scopes.length === 0) return [];
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);
    const rows = await this.rows<{ ServiceName: string }>(
      `SELECT DISTINCT ServiceName FROM ${this.spans} WHERE ${clause} AND ExperimentId IN {experimentIds:Array(String)} ORDER BY ServiceName LIMIT 1000`,
      { ...params, experimentIds: scopes.map((s) => tenantParams(s).tenantExperiment) },
    );
    return rows.map((r) => r.ServiceName);
  }

  /** Una sola consulta agrupada por experimento: evita N consultas al comparar coste entre varios experimentos. */
  async getUsageByServices(scopes: TenantScope[], { fromMs, toMs }: TimeRange): Promise<ServiceUsage[]> {
    if (scopes.length === 0) return [];
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);
    const rows = await this.rows(
      `SELECT ExperimentId, ServiceName, countIf(ParentSpanId = '') AS traces,
              sumIf(${attrNum("gen_ai.usage.input_tokens")}, ${OP} = 'chat') AS inputTokens,
              sumIf(${attrNum("gen_ai.usage.output_tokens")}, ${OP} = 'chat') AS outputTokens,
              sumIf(${TOKENS}, ${OP} = 'chat') AS totalTokens
       FROM ${this.spans} WHERE ${clause} AND ExperimentId IN {experimentIds:Array(String)}
       GROUP BY ExperimentId, ServiceName`,
      { ...params, experimentIds: scopes.map((s) => tenantParams(s).tenantExperiment) },
    );
    return rows.map((r) => ({
      experimentId: String(r.ExperimentId),
      serviceName: String(r.ServiceName),
      traces: num(r.traces),
      inputTokens: num(r.inputTokens),
      outputTokens: num(r.outputTokens),
      totalTokens: num(r.totalTokens),
    }));
  }

  async listSpans(q: SpanListQuery): Promise<Page<SpanRecord, SpanCursor>> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const where = [clause];
    const p: Params = { ...params, limit: q.limit + 1 };

    where.push(TENANT_SQL);
    Object.assign(p, tenantParams(q.scope));
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
      where.push(CONTENT_MATCH);
      p.text = q.text;
    }
    if (q.revision) {
      where.push("startsWith(Revision, {revision:String})");
      p.revision = q.revision.toLowerCase();
    }
    if (q.promptName) {
      where.push("PromptName = {promptName:String}");
      p.promptName = q.promptName;
      if (q.promptVersion) {
        where.push("PromptVersion = {promptVersion:UInt32}");
        p.promptVersion = q.promptVersion;
      }
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
              if(${OP} = 'chat', ${attrNum("gen_ai.usage.input_tokens")}, 0) AS inputTokens,
              if(${OP} = 'chat', ${attrNum("gen_ai.usage.output_tokens")}, 0) AS outputTokens,
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
      inputTokens: r.isChat ? num(r.inputTokens) : null,
      outputTokens: r.isChat ? num(r.outputTokens) : null,
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

    where.push(TENANT_SQL);
    Object.assign(p, tenantParams(q.scope));
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
        `TraceId IN (SELECT TraceId FROM ${this.spans} WHERE ${TENANT_SQL} AND StatusCode = ${ERROR} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`,
      );
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    if (q.text) {
      where.push(`TraceId IN (SELECT TraceId FROM ${this.spans} WHERE ${TENANT_SQL} AND ${CONTENT_MATCH} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`);
      p.text = q.text;
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    if (q.conversationId) {
      where.push("ConversationId = {conversationId:String}");
      p.conversationId = q.conversationId;
    }
    if (q.revision) {
      // el commit completo o un prefijo (el SHA corto que muestra el dashboard)
      where.push("startsWith(Revision, {revision:String})");
      p.revision = q.revision.toLowerCase();
    }
    if (q.promptName) {
      // el prompt lo marca el span que lo usa (normalmente una llamada al modelo), no la raíz: se busca en toda la traza
      const version = q.promptVersion ? " AND PromptVersion = {promptVersion:UInt32}" : "";
      where.push(`TraceId IN (SELECT TraceId FROM ${this.spans} WHERE ${TENANT_SQL} AND PromptName = {promptName:String}${version} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`);
      p.promptName = q.promptName;
      if (q.promptVersion) p.promptVersion = q.promptVersion;
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    const dir = q.order === "asc" ? "ASC" : "DESC";
    if (q.cursor) {
      where.push(`(toUnixTimestamp64Micro(Timestamp), TraceId) ${dir === "ASC" ? ">" : "<"} ({cursorUs:Int64}, {cursorTraceId:String})`);
      p.cursorUs = q.cursor.startTimeUs;
      p.cursorTraceId = q.cursor.traceId;
    }

    const roots = await this.rows(
      `SELECT TraceId, SpanName, ServiceName, ConversationId, Revision, toUnixTimestamp64Micro(Timestamp) AS startUs, Duration, StatusCode, StatusMessage
       FROM ${this.spans} WHERE ${where.join(" AND ")}
       ORDER BY startUs ${dir}, TraceId ${dir} LIMIT {limit:UInt32}`,
      p,
    );

    const hasMore = roots.length > q.limit;
    const page = roots.slice(0, q.limit);
    const aggregates = await this.aggregatesFor(q.scope, page);

    const items: TraceSummary[] = page.map((r) => {
      const agg = aggregates.get(String(r.TraceId));
      const status = toStatus(r.StatusCode);
      // Si la traza falló y lo último con salida es una herramienta, el agente nunca llegó a responder:
      // el resultado de la herramienta no es la respuesta, así que se muestra el error en su lugar.
      const noAnswer = status === "error" && agg?.outputTool === true;
      return {
        traceId: String(r.TraceId),
        rootSpanName: String(r.SpanName),
        serviceName: String(r.ServiceName),
        startTimeUs: num(r.startUs),
        durationMs: nsToMs(r.Duration),
        status,
        spanCount: agg?.spanCount ?? 1,
        errorCount: agg?.errorCount ?? 0,
        totalTokens: agg?.totalTokens ?? 0,
        input: agg ? previewOf(agg.inputRaw, "input", agg.inputChat) : null,
        output: agg && !noAnswer ? previewOf(agg.outputRaw, "output", agg.outputChat) : null,
        error: status === "error" && r.StatusMessage ? previewOf(String(r.StatusMessage), "output", false) : null,
        conversationId: r.ConversationId ? String(r.ConversationId) : null,
        revision: r.Revision ? String(r.Revision) : null,
        prompts: agg?.prompts ?? [],
      };
    });

    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? { startTimeUs: last.startTimeUs, traceId: last.traceId } : null };
  }

  /** Agregados por traza para una página, acotados en tiempo para podar particiones diarias. */
  private async aggregatesFor(scope: TenantScope, roots: Row[]) {
    const result = new Map<string, { spanCount: number; errorCount: number; totalTokens: number; inputRaw: string | null; inputChat: boolean; outputRaw: string | null; outputChat: boolean; outputTool: boolean; prompts: PromptRef[] }>();
    if (roots.length === 0) return result;

    const startsMs = roots.map((r) => num(r.startUs) / 1000);
    const fromMs = Math.floor(Math.min(...startsMs));
    const toMs = Math.ceil(Math.max(...startsMs)) + TRACE_WINDOW_MS;
    const { clause, params } = ClickHouseTraceRepository.range(fromMs, toMs);

    // Entrada = la del primer span que la tiene; salida = la del último en terminar.
    // `invoke_agent` (Pydantic AI) guarda en gen_ai.input.messages solo el último mensaje enviado, que puede ser la respuesta de una herramienta y no el del usuario: su entrada sale del primer `chat`.
    const inputExpr = `if(${OP} = 'invoke_agent', ${firstOf(["memtrace.input"])}, ${firstOf(["memtrace.input", "gen_ai.input.messages", "gen_ai.tool.call.arguments"])})`;
    const outputExpr = firstOf(["memtrace.output", "gen_ai.output.messages", "gen_ai.tool.call.result"]);
    const rows = await this.rows(
      `SELECT TraceId, uniqExact(SpanId) AS spanCount, uniqExactIf(SpanId, StatusCode = ${ERROR}) AS errorCount,
              sumIf(${TOKENS}, ${OP} = 'chat') AS totalTokens,
              argMinIf(${inputExpr}, Timestamp, ${inputExpr} != '') AS inputRaw,
              argMinIf(${OP} = 'chat', Timestamp, ${inputExpr} != '') AS inputChat,
              argMaxIf(${outputExpr}, Timestamp + toIntervalNanosecond(Duration), ${outputExpr} != '') AS outputRaw,
              argMaxIf(${OP} = 'chat', Timestamp + toIntervalNanosecond(Duration), ${outputExpr} != '') AS outputChat,
              argMaxIf(${OP} = 'execute_tool', Timestamp + toIntervalNanosecond(Duration), ${outputExpr} != '') AS outputTool,
              groupUniqArrayIf(20)((PromptName, PromptVersion), PromptName != '') AS prompts
       FROM ${this.spans} WHERE TraceId IN {ids:Array(String)} AND ${TENANT_SQL} AND ${clause} GROUP BY TraceId`,
      { ...params, ...tenantParams(scope), ids: roots.map((r) => String(r.TraceId)) },
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
        outputTool: Boolean(r.outputTool),
        prompts: promptRefs(r.prompts),
      });
    }
    return result;
  }

  async listConversations(q: ConversationListQuery): Promise<Page<ConversationSummary, ConversationCursor>> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const where = ["ParentSpanId = ''", "ConversationId != ''", clause];
    const p: Params = { ...params, limit: q.limit + 1 };

    where.push(TENANT_SQL);
    Object.assign(p, tenantParams(q.scope));
    if (q.hasErrors) {
      where.push(
        `ConversationId IN (SELECT ConversationId FROM ${this.spans} WHERE ${TENANT_SQL} AND ConversationId != '' AND StatusCode = ${ERROR} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`,
      );
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    if (q.text) {
      where.push(
        `ConversationId IN (SELECT ConversationId FROM ${this.spans} WHERE ${TENANT_SQL} AND ConversationId != '' AND ${CONTENT_MATCH} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`,
      );
      p.text = q.text;
      p.toWithWindowMs = q.toMs + TRACE_WINDOW_MS;
    }
    if (q.revision) {
      where.push("startsWith(Revision, {revision:String})");
      p.revision = q.revision.toLowerCase();
    }
    if (q.promptName) {
      // el prompt lo marca el span que lo usa (no la raíz del turno): la conversación entra si algún span suyo lo usó (ADR-068)
      const version = q.promptVersion ? " AND PromptVersion = {promptVersion:UInt32}" : "";
      where.push(
        `ConversationId IN (SELECT ConversationId FROM ${this.spans} WHERE ${TENANT_SQL} AND ConversationId != '' AND PromptName = {promptName:String}${version} AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64}))`,
      );
      p.promptName = q.promptName;
      if (q.promptVersion) p.promptVersion = q.promptVersion;
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
    const summaries = await this.conversationSummaries(q.scope, page, q.toMs);
    const items = page.map((id) => summaries.get(id)).filter((s): s is ConversationSummary => s !== undefined);
    const lastRow = found[q.limit - 1];
    return {
      items,
      nextCursor: hasMore && lastRow ? { lastActivityUs: num(lastRow.lastUs), conversationId: String(lastRow.ConversationId) } : null,
    };
  }

  async getConversation(scope: TenantScope, conversationId: string, range: TimeRange): Promise<ConversationSummary | null> {
    const found = await this.conversationSummaries(scope, [conversationId], range.toMs);
    return found.get(conversationId) ?? null;
  }

  /** Cifras por conversación en una sola pasada sobre la columna `ConversationId` (ADR-012). */
  private async conversationSummaries(scope: TenantScope, ids: string[], toMs: number): Promise<Map<string, ConversationSummary>> {
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
              sumIf(Duration, ParentSpanId = '') AS activeNs,
              groupUniqArrayIf(20)((PromptName, PromptVersion), PromptName != '') AS prompts
       FROM ${this.spans} WHERE ConversationId IN {ids:Array(String)} AND ${TENANT_SQL} AND ${clause} GROUP BY ConversationId`,
      { ...params, ...tenantParams(scope), ids },
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
        prompts: promptRefs(r.prompts),
      });
    }
    return result;
  }

  async getConversationUsage(scope: TenantScope, ids: string[], toMs: number): Promise<Map<string, ConversationUsage>> {
    const result = new Map<string, ConversationUsage>();
    if (ids.length === 0) return result;
    const { clause, params } = ClickHouseTraceRepository.range(toMs - MAX_RANGE_MS, toMs + TRACE_WINDOW_MS);
    const where = `ConversationId IN {ids:Array(String)} AND ${OP} = 'chat' AND ${TENANT_SQL} AND ${clause}`;
    const [first, usage] = await Promise.all([
      this.rows(
        `SELECT ConversationId, argMin(SpanAttributes['gen_ai.input.messages'], Timestamp) AS firstInput
         FROM ${this.spans} WHERE ${where} GROUP BY ConversationId`,
        { ...params, ...tenantParams(scope), ids },
      ),
      this.rows(
        `SELECT ConversationId, ${attr("gen_ai.request.model")} AS model,
                sum(${attrNum("gen_ai.usage.input_tokens")}) AS inputTokens,
                sum(${attrNum("gen_ai.usage.output_tokens")}) AS outputTokens
         FROM ${this.spans} WHERE ${where} GROUP BY ConversationId, model`,
        { ...params, ...tenantParams(scope), ids },
      ),
    ]);
    for (const r of first) {
      result.set(String(r.ConversationId), { firstInput: r.firstInput ? String(r.firstInput) : null, models: [] });
    }
    for (const r of usage) {
      const entry = result.get(String(r.ConversationId)) ?? { firstInput: null, models: [] };
      entry.models.push({ model: r.model ? String(r.model) : null, inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens) });
      result.set(String(r.ConversationId), entry);
    }
    return result;
  }

  async getConversationTraceIds(scope: TenantScope, ids: string[], toMs: number): Promise<Map<string, string[]>> {
    if (ids.length === 0) return new Map();
    const { clause, params } = ClickHouseTraceRepository.range(toMs - MAX_RANGE_MS, toMs + TRACE_WINDOW_MS);
    const rows = await this.rows(
      `SELECT ConversationId, groupUniqArray(TraceId) AS traceIds FROM ${this.spans} WHERE ConversationId IN {ids:Array(String)} AND ${TENANT_SQL} AND ${clause} GROUP BY ConversationId`,
      { ...params, ...tenantParams(scope), ids },
    );
    return new Map(rows.map((r) => [String(r.ConversationId), (r.traceIds as unknown[]).map(String)]));
  }

  async getConversationMessages(scope: TenantScope, conversationId: string, range: TimeRange, maxSpans: number): Promise<{ records: ChatSpanRecord[]; truncated: boolean }> {
    const { clause, params } = ClickHouseTraceRepository.range(range.toMs - MAX_RANGE_MS, range.toMs + TRACE_WINDOW_MS);
    const rows = await this.rows(
      `SELECT TraceId, toUnixTimestamp64Micro(Timestamp) AS startUs,
              SpanAttributes['gen_ai.request.model'] AS model,
              SpanAttributes['gen_ai.input.messages'] AS input,
              SpanAttributes['gen_ai.output.messages'] AS output
       FROM ${this.spans}
       WHERE ConversationId = {conversationId:String} AND ${OP} = 'chat' AND ${TENANT_SQL} AND ${clause}
       ORDER BY Timestamp ASC LIMIT {limit:UInt32}`,
      { ...params, ...tenantParams(scope), conversationId, limit: maxSpans + 1 },
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

  async getTraceSpans(scope: TenantScope, traceId: string, maxSpans: number): Promise<TraceSpans | null> {
    // El índice se alimenta por bloque de inserción: una traza puede tener varias filas
    const [bounds] = await this.rows(
      `SELECT count() AS n, toUnixTimestamp64Micro(min(Start)) AS startUs, toUnixTimestamp64Micro(max(End)) AS endUs
       FROM ${this.traceIndex} WHERE TraceId = {traceId:String}`,
      { traceId },
    );
    if (!bounds || num(bounds.n) === 0) return null;

    const rows = await this.rows(
      `SELECT SpanId, ParentSpanId, SpanName, ServiceName, ScopeName, toUnixTimestamp64Micro(Timestamp) AS startUs,
              Duration, StatusCode, StatusMessage, SpanAttributes, Revision,
              \`Events.Name\` AS evName, \`Events.Attributes\` AS evAttrs,
              arrayMap(t -> toUnixTimestamp64Micro(t), \`Events.Timestamp\`) AS evTs
       FROM ${this.spans}
       WHERE TraceId = {traceId:String} AND ${TENANT_SQL}
         AND Timestamp >= fromUnixTimestamp64Micro({startUs:Int64}) AND Timestamp <= fromUnixTimestamp64Micro({endUs:Int64})
       ORDER BY Timestamp ASC LIMIT {limit:UInt32}`,
      { ...tenantParams(scope), traceId, startUs: num(bounds.startUs), endUs: num(bounds.endUs), limit: maxSpans + 1 },
    );
    // El índice de trazas no conoce al tenant: si la traza es de otro experimento, aquí no hay spans y es como si no existiera.
    if (rows.length === 0) return null;

    const spans: Span[] = rows.slice(0, maxSpans).map((r) => {
      const evName = (r.evName as string[]) ?? [];
      const evAttrs = (r.evAttrs as Record<string, string>[]) ?? [];
      const evTs = (r.evTs as unknown[]) ?? [];
      return {
        spanId: String(r.SpanId),
        parentSpanId: r.ParentSpanId ? String(r.ParentSpanId) : null,
        name: String(r.SpanName),
        serviceName: String(r.ServiceName),
        scopeName: String(r.ScopeName),
        startTimeUs: num(r.startUs),
        durationMs: nsToMs(r.Duration),
        status: { code: toStatus(r.StatusCode), message: r.StatusMessage ? String(r.StatusMessage) : null },
        attributes: (r.SpanAttributes as Record<string, string>) ?? {},
        events: evName.map((name, i) => ({ name, timeUs: num(evTs[i]), attributes: evAttrs[i] ?? {} })),
        revision: r.Revision ? String(r.Revision) : null,
      };
    });
    return { spans, truncated: rows.length > maxSpans };
  }

  /** Latencia (span raíz) y tokens de LLM por modelo de varias trazas, en una sola consulta acotada por la ventana temporal de esas trazas. */
  async getTraceStatsForTraces(scope: TenantScope, traceIds: string[]): Promise<Map<string, TraceStats>> {
    const result = new Map<string, TraceStats>();
    if (traceIds.length === 0) return result;

    const [bounds] = await this.rows(
      `SELECT toUnixTimestamp64Micro(min(Start)) AS startUs, toUnixTimestamp64Micro(max(End)) AS endUs
       FROM ${this.traceIndex} WHERE TraceId IN {ids:Array(String)}`,
      { ids: traceIds },
    );
    if (!bounds || bounds.startUs == null) return result;

    const rows = await this.rows(
      `SELECT TraceId,
              ${attr("gen_ai.request.model")} AS model,
              maxIf(Duration, ParentSpanId = '') AS rootNs,
              sumIf(${attrNum("gen_ai.usage.input_tokens")}, ${OP} = 'chat') AS inputTokens,
              sumIf(${attrNum("gen_ai.usage.output_tokens")}, ${OP} = 'chat') AS outputTokens,
              countIf(${OP} = 'chat') AS chatCalls,
              groupUniqArrayIf(20)((PromptName, PromptVersion), PromptName != '') AS prompts
       FROM ${this.spans}
       WHERE TraceId IN {ids:Array(String)} AND ${TENANT_SQL}
         AND Timestamp >= fromUnixTimestamp64Micro({startUs:Int64}) AND Timestamp <= fromUnixTimestamp64Micro({endUs:Int64})
       GROUP BY TraceId, model`,
      { ...tenantParams(scope), ids: traceIds, startUs: num(bounds.startUs), endUs: num(bounds.endUs) },
    );

    for (const r of rows) {
      const traceId = String(r.TraceId);
      const stats = result.get(traceId) ?? { traceId, durationMs: 0, byModel: [], prompts: [] };
      stats.durationMs = Math.max(stats.durationMs, nsToMs(r.rootNs));
      // la traza se parte en una fila por modelo: las versiones de prompt se juntan sin repetir
      for (const p of promptRefs(r.prompts)) {
        if (!stats.prompts.some((q) => q.name === p.name && q.version === p.version)) stats.prompts.push(p);
      }
      if (num(r.chatCalls) > 0) {
        stats.byModel.push({ model: r.model ? String(r.model) : null, inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens) });
      }
      result.set(traceId, stats);
    }
    return result;
  }

  /** Igual que `getTraceSpans` pero para varias trazas en una sola consulta (vista de árbol de conversación). */
  async getTraceSpansForTraces(scope: TenantScope, traceIds: string[], maxSpansPerTrace: number): Promise<Map<string, TraceSpans>> {
    const result = new Map<string, TraceSpans>();
    if (traceIds.length === 0) return result;

    const [bounds] = await this.rows(
      `SELECT toUnixTimestamp64Micro(min(Start)) AS startUs, toUnixTimestamp64Micro(max(End)) AS endUs
       FROM ${this.traceIndex} WHERE TraceId IN {ids:Array(String)}`,
      { ids: traceIds },
    );
    if (!bounds || bounds.startUs == null) return result;

    // rn cuenta los spans de cada traza por separado: permite truncar cada una a `maxSpansPerTrace` sin
    // que una traza grande se coma el presupuesto de las demás.
    const rows = await this.rows(
      `SELECT SpanId, TraceId, ParentSpanId, SpanName, ServiceName, ScopeName, startUs,
              Duration, StatusCode, StatusMessage, SpanAttributes, evName, evAttrs, evTs
       FROM (
         SELECT SpanId, TraceId, ParentSpanId, SpanName, ServiceName, ScopeName, toUnixTimestamp64Micro(Timestamp) AS startUs,
                Duration, StatusCode, StatusMessage, SpanAttributes,
                \`Events.Name\` AS evName, \`Events.Attributes\` AS evAttrs,
                arrayMap(t -> toUnixTimestamp64Micro(t), \`Events.Timestamp\`) AS evTs,
                row_number() OVER (PARTITION BY TraceId ORDER BY Timestamp ASC) AS rn
         FROM ${this.spans}
         WHERE TraceId IN {ids:Array(String)} AND ${TENANT_SQL}
           AND Timestamp >= fromUnixTimestamp64Micro({startUs:Int64}) AND Timestamp <= fromUnixTimestamp64Micro({endUs:Int64})
       )
       WHERE rn <= {maxSpansPerTrace:UInt32}
       ORDER BY TraceId ASC, startUs ASC`,
      { ...tenantParams(scope), ids: traceIds, startUs: num(bounds.startUs), endUs: num(bounds.endUs), maxSpansPerTrace: maxSpansPerTrace + 1 },
    );

    const byTraceId = new Map<string, Row[]>();
    for (const r of rows) {
      const traceId = String(r.TraceId);
      const list = byTraceId.get(traceId) ?? [];
      list.push(r);
      byTraceId.set(traceId, list);
    }

    for (const [traceId, group] of byTraceId) {
      const page = group.slice(0, maxSpansPerTrace);
      const spans: Span[] = page.map((r) => {
        const evName = (r.evName as string[]) ?? [];
        const evAttrs = (r.evAttrs as Record<string, string>[]) ?? [];
        const evTs = (r.evTs as unknown[]) ?? [];
        return {
          spanId: String(r.SpanId),
          parentSpanId: r.ParentSpanId ? String(r.ParentSpanId) : null,
          name: String(r.SpanName),
          serviceName: String(r.ServiceName),
          scopeName: String(r.ScopeName),
          startTimeUs: num(r.startUs),
          durationMs: nsToMs(r.Duration),
          status: { code: toStatus(r.StatusCode), message: r.StatusMessage ? String(r.StatusMessage) : null },
          attributes: (r.SpanAttributes as Record<string, string>) ?? {},
          events: evName.map((name, i) => ({ name, timeUs: num(evTs[i]), attributes: evAttrs[i] ?? {} })),
        };
      });
      result.set(traceId, { spans, truncated: group.length > maxSpansPerTrace });
    }
    return result;
  }

  async getOverview(q: MetricsQuery): Promise<MetricsOverview> {
    const { clause, params } = ClickHouseTraceRepository.range(q.fromMs, q.toMs);
    const svc = ` AND ${TENANT_SQL}`;
    const p: Params = { ...params, bucket: q.bucketSeconds, ...tenantParams(q.scope) };
    const from = `FROM ${this.spans} WHERE ${clause}${svc}`;
    const bucket = "intDiv(toUnixTimestamp(Timestamp), {bucket:UInt32}) * {bucket:UInt32}";

    const [totals, spanTotals, series, tokenSeries, models, tools, topics] = await Promise.all([
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
                count() AS calls, countIf(StatusCode = ${ERROR}) AS errors, quantile(0.95)(Duration) AS p95,
                anyIf(${attr("memtrace.mcp_server")}, ${attr("memtrace.mcp_server")} != '') AS mcpServer
         ${from} AND ${OP} = 'execute_tool' GROUP BY tool ORDER BY calls DESC LIMIT 50`,
        p,
      ),
      this.rows(
        `SELECT st.Topic AS topic, count() AS responses, avg(st.Confidence) AS avgConfidence
         FROM ${this.topics} AS st FINAL
         INNER JOIN ${this.spans} AS t ON t.TraceId = st.TraceId AND t.SpanId = st.SpanId
         WHERE ${clause.replace(/(?<![\w.])Timestamp\b/g, "t.Timestamp")}AND ${tenantSqlFor("t")}
         GROUP BY st.Topic ORDER BY responses DESC LIMIT 100`,
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
        costUsd: 0, // el repositorio no conoce precios: TraceQueryService lo sustituye por el coste real (ADR-025)
      },
      latencyMs: { p50: nsToMs(quantiles[0]), p95: nsToMs(quantiles[1]), p99: nsToMs(quantiles[2]) },
      timeseries,
      byModel: models.map((r) => ({
        model: String(r.model || "unknown"),
        calls: num(r.calls),
        inputTokens: num(r.inputTokens),
        outputTokens: num(r.outputTokens),
        p95Ms: nsToMs(r.p95),
        costUsd: null, // idem: TraceQueryService lo rellena con el catálogo de precios
      })),
      byTool: tools.map((r) => ({
        tool: String(r.tool),
        calls: num(r.calls),
        errors: num(r.errors),
        p95Ms: nsToMs(r.p95),
        mcpServer: r.mcpServer ? String(r.mcpServer) : null,
      })),
      byTopic: topics.map((r) => ({
        topic: String(r.topic),
        responses: num(r.responses),
        avgConfidence: num(r.avgConfidence),
      })),
    };
  }
}
