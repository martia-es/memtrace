import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { EpisodeRepository } from "@/application/ports/episode-repository";
import type { TenantScope } from "@/domain/tenant";
import type { EpisodeSignals } from "@/domain/uncertainty";
import { QueryLimiter } from "./query-limiter";
import { TENANT_SQL, tenantParams } from "./tenant-sql";

interface EpisodeRow {
  TraceId: string;
  Value: number;
  Thumbs: number;
  EvalScore: number | null;
  HasError: number;
  Reasons: string[];
}

/** `mem_episodes` es ReplacingMergeTree por traza (gana la última `BuiltAt`): se lee con FINAL (migración 018). */
export class ClickHouseEpisodeRepository implements EpisodeRepository {
  private readonly limiter: QueryLimiter;

  constructor(private readonly readClient: ClickHouseClient, private readonly database: string, maxConcurrentQueries = 3) {
    this.limiter = new QueryLimiter(maxConcurrentQueries);
  }

  async signalsForTraces(scope: TenantScope, traceIds: string[]): Promise<Map<string, EpisodeSignals>> {
    const out = new Map<string, EpisodeSignals>();
    if (traceIds.length === 0) return out;
    try {
      const rows = await this.limiter.run(async () => {
        const result = await this.readClient.query({
          query: `SELECT TraceId, Value, Thumbs, EvalScore, HasError, Reasons
                    FROM ${this.database}.mem_episodes FINAL
                   WHERE ${TENANT_SQL} AND TraceId IN {traceIds:Array(String)}`,
          query_params: { ...tenantParams(scope), traceIds },
          format: "JSONEachRow",
        });
        return result.json<EpisodeRow>();
      });
      for (const r of rows) {
        out.set(r.TraceId, { value: Number(r.Value), thumbs: Number(r.Thumbs), evalScore: r.EvalScore === null ? null : Number(r.EvalScore), hasError: Number(r.HasError) === 1, reasons: r.Reasons });
      }
      return out;
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (mem episodes) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }
}
