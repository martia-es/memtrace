import type { ClickHouseClient } from "@clickhouse/client";
import type { TracePurger } from "@/application/ports/trace-purger";

/**
 * Borra spans antiguos de un servicio (ADR-084). Primero las temáticas derivadas, que se localizan por las trazas que se van
 * a borrar, y después los spans. El índice `otel_traces_trace_id_ts` no lleva `ServiceName` ni contenido (solo ids y
 * tiempos) y lo vacía su propio TTL de techo.
 */
export class ClickHouseTracePurger implements TracePurger {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly database: string,
  ) {}

  async purge(serviceName: string, cutoff: Date): Promise<{ spans: number }> {
    const params = { serviceName, cutoffMs: cutoff.getTime() };
    const where = "ServiceName = {serviceName:String} AND Timestamp < fromUnixTimestamp64Milli({cutoffMs:Int64})";
    const counted = await this.client.query({ query: `SELECT count() AS n FROM ${this.database}.otel_traces WHERE ${where}`, query_params: params, format: "JSONEachRow" });
    const spans = Number(((await counted.json()) as { n: string | number }[])[0]?.n ?? 0);
    if (spans === 0) return { spans: 0 };

    // `mutations_sync: 1` espera a que termine cada mutación: las temáticas se buscan en `otel_traces`, así que los spans
    // no pueden desaparecer antes.
    const settings = { mutations_sync: "1" as const };
    await this.client.command({
      query: `ALTER TABLE ${this.database}.span_topics DELETE WHERE TraceId IN (SELECT TraceId FROM ${this.database}.otel_traces WHERE ${where})`,
      query_params: params,
      clickhouse_settings: settings,
    });
    await this.client.command({ query: `ALTER TABLE ${this.database}.otel_traces DELETE WHERE ${where}`, query_params: params, clickhouse_settings: settings });
    return { spans };
  }
}
