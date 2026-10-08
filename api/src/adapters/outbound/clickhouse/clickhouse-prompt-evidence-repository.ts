import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { PromptEvidenceRepository } from "@/application/ports/prompt-evidence-repository";
import type { PromptEvidenceRows } from "@/domain/prompt-evidence";
import type { TimeRange } from "@/domain/time-range";
import { ERROR, KIND, OP, TRACE_WINDOW_MS, attr, attrNum, nsToMs, num } from "./clickhouse-trace-repository";
import { QueryLimiter } from "./query-limiter";

type Row = Record<string, unknown>;
type Params = Record<string, string | number | string[]>;

/** Las trazas del playground (ADR-071) son pruebas con mensajes inventados: no cuentan como evidencia ni para el gate. */
const NOT_PLAYGROUND = `${attr("memtrace.playground")} != 'true'`;

const exceptionAttr = (key: string) => `arrayElement(arrayMap(a -> a['${key}'], \`Events.Attributes\`), indexOf(\`Events.Name\`, 'exception'))`;

/**
 * Evidencia por versión de un prompt (ADR-069). Todo parte de las trazas con algún span marcado con
 * `PromptName`/`PromptVersion` (ADR-068): `used` son sus pares (traza, versión), y cada consulta mira el resto de los
 * spans, el feedback o los scores de esas trazas. Una traza que usó dos versiones cuenta en las dos.
 *
 * Es un modelo de lectura que cruza tablas a propósito: la alternativa, traer los ids de las trazas y consultar cada
 * almacén por separado, obliga a acotar el número de trazas y falsea las cifras.
 */
export class ClickHousePromptEvidenceRepository implements PromptEvidenceRepository {
  private readonly spans: string;
  private readonly feedback: string;
  private readonly evalItems: string;
  private readonly evalScores: string;
  private readonly limiter: QueryLimiter;

  constructor(
    private readonly client: ClickHouseClient,
    database = "memtrace",
    maxConcurrentQueries = 3,
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error(`Invalid database name: ${database}`);
    this.limiter = new QueryLimiter(maxConcurrentQueries);
    this.spans = `${database}.otel_traces`;
    this.feedback = `${database}.user_feedback`;
    this.evalItems = `${database}.eval_items`;
    this.evalScores = `${database}.eval_scores`;
  }

  async rowsFor({ fromMs, toMs, service, promptName }: TimeRange & { service: string; promptName: string }): Promise<PromptEvidenceRows> {
    const p: Params = { fromMs, toMs, toWithWindowMs: toMs + TRACE_WINDOW_MS, service, promptName };
    const inRange = "Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toMs:Int64})";
    // el resto de los spans de una traza pueden terminar después de que acabe el rango
    const inWindow = "Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64})";
    const usedPairs = `SELECT TraceId, PromptVersion AS version FROM ${this.spans} WHERE PromptName = {promptName:String} AND ServiceName = {service:String} AND ${NOT_PLAYGROUND} AND ${inRange} GROUP BY TraceId, PromptVersion`;
    const usedIds = `SELECT TraceId FROM ${this.spans} WHERE PromptName = {promptName:String} AND ServiceName = {service:String} AND ${NOT_PLAYGROUND} AND ${inRange}`;
    const joined = `FROM ${this.spans} INNER JOIN (${usedPairs}) AS used USING (TraceId) WHERE ServiceName = {service:String} AND ${inWindow}`;

    const failed = `StatusCode = ${ERROR}`;
    const failedInWindow = `${failed} AND ServiceName = {service:String} AND ${inWindow}`;

    const [traces, tokens, errors, feedback, evaluators] = await Promise.all([
      this.rows(
        `SELECT version, uniqExact(TraceId) AS traces, uniqExactIf(TraceId, ${failed}) AS errorTraces,
                uniqExactIf(ConversationId, ConversationId != '') AS conversations,
                quantileIf(0.5)(Duration, ParentSpanId = '') AS p50, quantileIf(0.95)(Duration, ParentSpanId = '') AS p95,
                toUnixTimestamp64Milli(min(Timestamp)) AS firstMs, toUnixTimestamp64Milli(max(Timestamp)) AS lastMs
         ${joined} GROUP BY version ORDER BY version DESC`,
        p,
      ),
      this.rows(
        `SELECT version, ${attr("gen_ai.request.model")} AS model, sum(${attrNum("gen_ai.usage.input_tokens")}) AS inputTokens, sum(${attrNum("gen_ai.usage.output_tokens")}) AS outputTokens
         ${joined} AND ${OP} = 'chat' GROUP BY version, model`,
        p,
      ),
      // solo el fallo más profundo de cada rama (ADR-066): un span cuyo hijo también falla propaga el mismo error
      this.rows(
        `SELECT version, ${KIND} AS kind, multiIf(${attr("gen_ai.tool.name")} != '', ${attr("gen_ai.tool.name")}, ${attr("gen_ai.request.model")} != '', ${attr("gen_ai.request.model")}, SpanName) AS errName,
                substring(StatusMessage, 1, 300) AS message, ${exceptionAttr("exception.type")} AS exceptionType, substring(${exceptionAttr("exception.message")}, 1, 300) AS exceptionMessage,
                count() AS occurrences, uniqExact(TraceId) AS traces, uniqExactIf(ConversationId, ConversationId != '') AS conversations,
                toUnixTimestamp64Milli(min(Timestamp)) AS firstMs, toUnixTimestamp64Milli(max(Timestamp)) AS lastMs
         ${joined} AND ${failed}
           AND (TraceId, SpanId) NOT IN (SELECT TraceId, ParentSpanId FROM ${this.spans} WHERE TraceId IN (${usedIds}) AND ${failedInWindow} AND ParentSpanId != '')
         GROUP BY version, kind, errName, message, exceptionType, exceptionMessage ORDER BY occurrences DESC LIMIT 500`,
        p,
      ),
      this.rows(
        `SELECT version, countIf(f.Rating = 1) AS up, countIf(f.Rating = -1) AS down, uniqExact(f.TraceId) AS ratedTraces
         FROM (SELECT TraceId, Rating FROM ${this.feedback} FINAL WHERE IsDeleted = 0 AND ServiceName = {service:String} AND TraceId IN (${usedIds})) AS f
         INNER JOIN (${usedPairs}) AS used ON f.TraceId = used.TraceId GROUP BY version`,
        p,
      ),
      // los scores de la evaluación offline cuyas trazas (la del item) usaron la versión
      this.rows(
        `SELECT version, s.Name AS name, any(s.DataType) AS dataType, count() AS items, avg(s.ValueNum) AS average
         FROM (SELECT DatasetRunId, ItemIndex, assumeNotNull(TraceId) AS TraceId FROM ${this.evalItems} FINAL WHERE ServiceName = {service:String} AND TraceId IS NOT NULL AND TraceId IN (${usedIds})) AS i
         INNER JOIN (${usedPairs}) AS used ON i.TraceId = used.TraceId
         INNER JOIN (SELECT DatasetRunId, ItemIndex, Name, DataType, ValueNum FROM ${this.evalScores} FINAL WHERE ServiceName = {service:String}) AS s
           ON s.DatasetRunId = i.DatasetRunId AND s.ItemIndex = i.ItemIndex
         GROUP BY version, name`,
        p,
      ),
    ]);

    return {
      traces: traces.map((r) => ({
        version: num(r.version),
        traces: num(r.traces),
        conversations: num(r.conversations),
        errorTraces: num(r.errorTraces),
        p50Ms: nsToMs(r.p50),
        p95Ms: nsToMs(r.p95),
        firstSeenMs: num(r.firstMs),
        lastSeenMs: num(r.lastMs),
      })),
      tokens: tokens.map((r) => ({ version: num(r.version), model: r.model ? String(r.model) : null, inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens) })),
      errors: errors.map((r) => ({
        version: num(r.version),
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
      feedback: feedback.map((r) => ({ version: num(r.version), up: num(r.up), down: num(r.down), ratedTraces: num(r.ratedTraces) })),
      evaluators: evaluators.map((r) => ({
        version: num(r.version),
        name: String(r.name),
        dataType: String(r.dataType),
        items: num(r.items),
        average: r.average === null || r.average === undefined || Number.isNaN(Number(r.average)) ? null : Number(r.average),
      })),
    };
  }

  async runsUsingVersion({ service, promptName, version, runIds }: { service: string; promptName: string; version: number; runIds: string[] }): Promise<string[]> {
    if (runIds.length === 0) return [];
    // las trazas viven 30 días (ADR-003): más atrás no hay marca que leer
    const rows = await this.rows(
      `SELECT i.DatasetRunId AS runId, countIf(used.version = {version:UInt32}) AS onVersion, countIf(used.version != {version:UInt32}) AS onOther
       FROM (SELECT DatasetRunId, assumeNotNull(TraceId) AS TraceId FROM ${this.evalItems} FINAL
              WHERE ServiceName = {service:String} AND DatasetRunId IN {runIds:Array(String)} AND TraceId IS NOT NULL) AS i
       INNER JOIN (SELECT TraceId, PromptVersion AS version FROM ${this.spans}
                    WHERE PromptName = {promptName:String} AND ServiceName = {service:String} AND ${NOT_PLAYGROUND} AND Timestamp >= now() - INTERVAL 31 DAY
                    GROUP BY TraceId, PromptVersion) AS used ON i.TraceId = used.TraceId
       GROUP BY runId HAVING onVersion > 0 AND onOther = 0`,
      { service, promptName, version, runIds },
    );
    return rows.map((r) => String(r.runId));
  }

  private async rows(query: string, params: Params): Promise<Row[]> {
    try {
      return await this.limiter.run(async () => {
        const result = await this.client.query({ query, query_params: params, format: "JSONEachRow" });
        return await result.json<Row>();
      });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }
}
