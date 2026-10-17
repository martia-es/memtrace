import type { ClickHouseClient } from "@clickhouse/client";
import { DEDUPED_READS } from "./client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { BreakdownRepository } from "@/application/ports/breakdown-repository";
import type { BreakdownGroup, BreakdownRows } from "@/domain/breakdown";
import type { TenantScope } from "@/domain/tenant";
import type { TimeRange } from "@/domain/time-range";
import { ERROR, OP, TRACE_WINDOW_MS, attr, attrNum, nsToMs, num } from "./clickhouse-trace-repository";
import { QueryLimiter } from "./query-limiter";
import { TENANT_SQL, tenantParams } from "./tenant-sql";

type Row = Record<string, unknown>;
type Params = Record<string, string | number | string[]>;

/** Las trazas del playground (ADR-071) son pruebas con mensajes inventados: no cuentan. */
const NOT_PLAYGROUND = `${attr("memtrace.playground")} != 'true'`;
const VERSION_LABEL = "concat(PromptName, ' v', toString(PromptVersion))";
/** El entorno viaja en el recurso (`deployment.environment.name`), igual en todos los spans de una traza. */
const ENVIRONMENT = "ResourceAttributes['deployment.environment.name']";
const MAX_GROUPS = 200;
const MAX_RELATED = 20;

/**
 * Clave del grupo, filtro de presencia y lo que se ve dentro de cada fila. Una traza que usó dos versiones cuenta en las
 * dos, como en la evidencia por versión (ADR-067).
 */
const GROUPS: Record<BreakdownGroup, { key: string; present: string; related: string }> = {
  prompt_version: { key: VERSION_LABEL, present: "PromptName != ''", related: `groupUniqArrayIf(${MAX_RELATED})(${ENVIRONMENT}, ${ENVIRONMENT} != '')` },
  environment: { key: ENVIRONMENT, present: `${ENVIRONMENT} != ''`, related: `groupUniqArrayIf(${MAX_RELATED})(${VERSION_LABEL}, PromptName != '')` },
  user: { key: "UserId", present: "UserId != ''", related: `groupUniqArrayIf(${MAX_RELATED})(${ENVIRONMENT}, ${ENVIRONMENT} != '')` },
};

/**
 * Overview › Breakdown. Todo parte de los pares (traza, grupo) del rango; cada consulta mira después el resto de los spans y el
 * feedback de esas trazas, como la evidencia por versión (ADR-067). Es un modelo de lectura que cruza tablas a propósito.
 */
export class ClickHouseBreakdownRepository implements BreakdownRepository {
  private readonly spans: string;
  private readonly feedback: string;
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
  }

  async rowsFor({ fromMs, toMs, scope, groupBy }: TimeRange & { scope: TenantScope; groupBy: BreakdownGroup }): Promise<BreakdownRows> {
    const g = GROUPS[groupBy];
    const p: Params = { fromMs, toMs, toWithWindowMs: toMs + TRACE_WINDOW_MS, ...tenantParams(scope) };
    const inRange = "Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toMs:Int64})";
    // el resto de los spans de una traza pueden terminar después de que acabe el rango
    const inWindow = "Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toWithWindowMs:Int64})";
    const usedPairs = `SELECT TraceId, ${g.key} AS grp FROM ${this.spans} WHERE ${g.present} AND ${TENANT_SQL} AND ${NOT_PLAYGROUND} AND ${inRange} GROUP BY TraceId, grp`;
    const usedIds = `SELECT TraceId FROM ${this.spans} WHERE ${g.present} AND ${TENANT_SQL} AND ${NOT_PLAYGROUND} AND ${inRange}`;
    const joined = `FROM ${this.spans} INNER JOIN (${usedPairs}) AS used USING (TraceId) WHERE ${TENANT_SQL} AND ${inWindow}`;
    const failed = `StatusCode = ${ERROR}`;

    const [groups, tokens, days, feedback] = await Promise.all([
      this.rows(
        `SELECT grp, uniqExact(TraceId) AS traces, uniqExactIf(TraceId, ${failed}) AS errorTraces,
                quantileIf(0.95)(Duration, ParentSpanId = '') AS p95, ${g.related} AS related
         ${joined} GROUP BY grp ORDER BY traces DESC LIMIT ${MAX_GROUPS}`,
        p,
      ),
      this.rows(
        `SELECT grp, ${attr("gen_ai.request.model")} AS model, sum(${attrNum("gen_ai.usage.input_tokens")}) AS inputTokens, sum(${attrNum("gen_ai.usage.output_tokens")}) AS outputTokens
         ${joined} AND ${OP} = 'chat' GROUP BY grp, model`,
        p,
      ),
      this.rows(
        `SELECT grp, toUnixTimestamp(toStartOfDay(Timestamp)) * 1000 AS dayMs, uniqExact(TraceId) AS traces, uniqExactIf(TraceId, ${failed}) AS errorTraces
         ${joined} GROUP BY grp, dayMs`,
        p,
      ),
      this.rows(
        `SELECT grp, countIf(f.Rating = 1) AS up, countIf(f.Rating = -1) AS down
         FROM (SELECT TraceId, Rating FROM ${this.feedback} FINAL WHERE IsDeleted = 0 AND ${TENANT_SQL} AND TraceId IN (${usedIds})) AS f
         INNER JOIN (${usedPairs}) AS used ON f.TraceId = used.TraceId GROUP BY grp`,
        p,
      ),
    ]);

    const rated = new Map(feedback.map((r) => [String(r.grp), { up: num(r.up), down: num(r.down) }]));
    return {
      groups: groups.map((r) => ({
        key: String(r.grp),
        traces: num(r.traces),
        errorTraces: num(r.errorTraces),
        p95Ms: r.p95 === null || r.p95 === undefined || Number.isNaN(Number(r.p95)) ? null : nsToMs(r.p95),
        related: ((r.related as unknown[]) ?? []).map(String).sort(),
        up: rated.get(String(r.grp))?.up ?? 0,
        down: rated.get(String(r.grp))?.down ?? 0,
      })),
      tokens: tokens.map((r) => ({ key: String(r.grp), model: r.model ? String(r.model) : null, inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens) })),
      days: days.map((r) => ({ key: String(r.grp), dayMs: num(r.dayMs), traces: num(r.traces), errorTraces: num(r.errorTraces) })),
    };
  }

  private async rows(query: string, params: Params): Promise<Row[]> {
    try {
      return await this.limiter.run(async () => {
        const result = await this.client.query({ query, query_params: params, format: "JSONEachRow", clickhouse_settings: DEDUPED_READS });
        return await result.json<Row>();
      });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }
}
