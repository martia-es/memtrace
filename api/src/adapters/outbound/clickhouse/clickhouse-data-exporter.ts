import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { DataExporter } from "@/application/ports/data-exporter";
import type { ExportKind } from "@/domain/data-export";
import { QueryLimiter } from "./query-limiter";

interface Source {
  table: string;
  timeColumn: string;
  /** tablas ReplacingMergeTree con lápidas: se leen con FINAL y sin las borradas */
  tombstones: boolean;
}

// Tabla y columna salen de este mapa cerrado, nunca de la petición
const SOURCES: Record<ExportKind, Source> = {
  traces: { table: "otel_traces", timeColumn: "Timestamp", tombstones: false },
  annotations: { table: "annotations", timeColumn: "CreatedAt", tombstones: true },
  feedback: { table: "user_feedback", timeColumn: "CreatedAt", tombstones: true },
  scores: { table: "eval_scores", timeColumn: "CreatedAt", tombstones: false },
};

/** Exporta con `SELECT *` en JSONEachRow, en flujo: la memoria no crece con el tamaño de la exportación. */
export class ClickHouseDataExporter implements DataExporter {
  private readonly limiter: QueryLimiter;

  constructor(
    private readonly client: ClickHouseClient,
    private readonly database: string,
    maxConcurrentQueries = 3,
  ) {
    this.limiter = new QueryLimiter(maxConcurrentQueries);
  }

  private where(source: Source): string {
    return `ServiceName = {serviceName:String} AND ${source.timeColumn} >= fromUnixTimestamp64Milli({fromMs:Int64}) AND ${source.timeColumn} < fromUnixTimestamp64Milli({toMs:Int64})${source.tombstones ? " AND IsDeleted = 0" : ""}`;
  }

  private params(serviceName: string, from: Date, to: Date) {
    return { serviceName, fromMs: from.getTime(), toMs: to.getTime() };
  }

  async count(serviceName: string, kind: ExportKind, from: Date, to: Date): Promise<number> {
    const source = SOURCES[kind];
    try {
      return await this.limiter.run(async () => {
        const result = await this.client.query({
          query: `SELECT count() AS n FROM ${this.database}.${source.table}${source.tombstones ? " FINAL" : ""} WHERE ${this.where(source)}`,
          query_params: this.params(serviceName, from, to),
          format: "JSONEachRow",
        });
        return Number(((await result.json()) as { n: string | number }[])[0]?.n ?? 0);
      });
    } catch (error) {
      throw new RepositoryUnavailableError(error);
    }
  }

  async *stream(serviceName: string, kind: ExportKind, from: Date, to: Date): AsyncIterable<string> {
    const source = SOURCES[kind];
    const result = await this.client.query({
      query: `SELECT * FROM ${this.database}.${source.table}${source.tombstones ? " FINAL" : ""} WHERE ${this.where(source)}`,
      query_params: this.params(serviceName, from, to),
      format: "JSONEachRow",
    });
    for await (const rows of result.stream()) {
      for (const row of rows) yield row.text;
    }
  }
}
