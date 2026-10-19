import type { ClickHouseClient } from "@clickhouse/client";
import { DEDUPED_READS } from "./client";
import type { TraceCounter } from "@/application/ports/trace-counter";
import type { TenantScope } from "@/domain/tenant";
import { TENANT_SQL, tenantParams } from "./tenant-sql";

/** Cuenta los spans de un experimento anteriores a una fecha (ADR-102): lo mismo que contaría el purgador, sin borrar. */
export class ClickHouseTraceCounter implements TraceCounter {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly database: string,
  ) {}

  async countOlderThan(scope: TenantScope, cutoff: Date): Promise<number> {
    const result = await this.client.query({
      query: `SELECT count() AS n FROM ${this.database}.otel_traces WHERE ${TENANT_SQL} AND Timestamp < fromUnixTimestamp64Milli({cutoffMs:Int64})`,
      query_params: { ...tenantParams(scope), cutoffMs: cutoff.getTime() },
      format: "JSONEachRow",
      clickhouse_settings: DEDUPED_READS,
    });
    return Number(((await result.json()) as { n: string | number }[])[0]?.n ?? 0);
  }
}
