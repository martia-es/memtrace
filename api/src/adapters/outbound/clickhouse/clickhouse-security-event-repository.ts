import type { ClickHouseClient } from "@clickhouse/client";
import { DEDUPED_READS } from "./client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { SecurityEventRepository } from "@/application/ports/security-event-repository";
import type { SecurityEventRow } from "@/domain/agent-security";
import type { TenantScope } from "@/domain/tenant";
import type { TimeRange } from "@/domain/time-range";
import { attr, num } from "./clickhouse-trace-repository";
import { QueryLimiter } from "./query-limiter";
import { TENANT_SQL, tenantParams } from "./tenant-sql";

/** Los spans de los detectores se llaman `security.<detector>` (ADR-103 §2). */
const SPAN_PREFIX = "security.";
const MAX_ROWS = 50_000;

/** Postura de seguridad: cuenta los spans `security.*` del agente. Una sola consulta agregada; no lee contenido. */
export class ClickHouseSecurityEventRepository implements SecurityEventRepository {
  private readonly spans: string;
  private readonly limiter: QueryLimiter;

  constructor(
    private readonly client: ClickHouseClient,
    database = "memtrace",
    maxConcurrentQueries = 3,
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error(`Invalid database name: ${database}`);
    this.limiter = new QueryLimiter(maxConcurrentQueries);
    this.spans = `${database}.otel_traces`;
  }

  async countEvents({ fromMs, toMs, scope }: TimeRange & { scope: TenantScope }): Promise<SecurityEventRow[]> {
    const query = `SELECT substring(SpanName, ${SPAN_PREFIX.length + 1}) AS detector,
                          ${attr("security.category")} AS category, ${attr("security.severity")} AS severity, ${attr("security.action")} AS action,
                          formatDateTime(Timestamp, '%Y-%m-%d', 'UTC') AS day, count() AS events
                     FROM ${this.spans}
                    WHERE ${TENANT_SQL} AND startsWith(SpanName, '${SPAN_PREFIX}') AND ${attr("security.detected")} = 'true'
                      AND ${attr("memtrace.playground")} != 'true'
                      AND ${attr("security.context")} != 'redteam'
                      AND Timestamp >= fromUnixTimestamp64Milli({fromMs:Int64}) AND Timestamp < fromUnixTimestamp64Milli({toMs:Int64})
                    GROUP BY detector, category, severity, action, day
                    ORDER BY day ASC LIMIT ${MAX_ROWS}`;
    try {
      const rows = await this.limiter.run(async () => {
        const result = await this.client.query({ query, query_params: { fromMs, toMs, ...tenantParams(scope) }, format: "JSONEachRow", clickhouse_settings: DEDUPED_READS });
        return await result.json<Record<string, unknown>>();
      });
      return rows.map((r) => ({
        detector: String(r.detector),
        category: String(r.category) || "unknown",
        severity: String(r.severity) || "unknown",
        action: String(r.action) || "observed",
        day: String(r.day),
        count: num(r.events),
      }));
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (security events) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }
}
