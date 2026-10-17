import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Mantenimiento periódico de `otel_traces` tras el cambio a ReplacingMergeTree (ADR-099).
 *
 * 1. **Compactar los días cerrados.** Cada inserción crea una parte; ClickHouse las funde en segundo plano, pero sin garantía de cuándo.
 *    Una partición con una sola parte es la que hace que `final = 1` no cueste nada (medido: sin esto, las consultas tardaban de 5 a 10
 *    veces más). Un día que ya no recibe datos se compacta una vez con `OPTIMIZE ... PARTITION ... FINAL`; si llega un span tardío, la
 *    siguiente pasada lo vuelve a compactar. Los dos últimos días no se tocan: siguen recibiendo inserciones.
 * 2. **Borrar la tabla anterior al cambio** (`otel_traces_pre_dedup`) pasados unos días: ocupa tanto como los datos y solo sirve para volver atrás.
 *
 * Idempotente y acotado: compacta como máximo `maxPartitions` particiones por pasada, para no cargar el servidor.
 */
export interface MaintenanceOptions {
  /** Días recientes que no se compactan. */
  recentDays: number;
  maxPartitions: number;
  /** Días que se conserva la tabla anterior al cambio; 0 la conserva para siempre. */
  keepPreviousDays: number;
  log: (message: string) => void;
}

export interface MaintenanceReport {
  compacted: string[];
  droppedPrevious: boolean;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DONE = "dedupe-otel-traces";

export class OtelTracesMaintenance {
  private readonly options: MaintenanceOptions;

  constructor(
    private readonly client: ClickHouseClient,
    private readonly database: string,
    options: Partial<MaintenanceOptions> = {},
  ) {
    if (!NAME.test(database)) throw new Error(`Invalid database name: ${database}`);
    this.options = { recentDays: 2, maxPartitions: 50, keepPreviousDays: 7, log: (m) => console.log(`[maintain] ${m}`), ...options };
  }

  async run(): Promise<MaintenanceReport> {
    const engine = await this.engine("otel_traces");
    if (engine !== "ReplacingMergeTree") {
      this.options.log("otel_traces is not a ReplacingMergeTree yet: nothing to maintain");
      return { compacted: [], droppedPrevious: false };
    }
    return { compacted: await this.compact(), droppedPrevious: await this.dropExpiredPrevious() };
  }

  /** Particiones (días) cerradas con más de una parte activa. */
  private async compact(): Promise<string[]> {
    const rows = await this.rows<{ partition: string; parts: string }>(
      `SELECT partition, count() AS parts FROM system.parts
        WHERE database = {database:String} AND table = 'otel_traces' AND active
        GROUP BY partition
       HAVING parts > 1 AND toDate(parseDateTimeBestEffort(partition)) < today() - {recent:UInt32}
        ORDER BY partition
        LIMIT {limit:UInt32}`,
      { database: this.database, recent: this.options.recentDays - 1, limit: this.options.maxPartitions },
    );
    const done: string[] = [];
    for (const { partition, parts } of rows) {
      // el nombre de la partición viene de system.parts (una fecha): aun así se valida antes de ponerlo en la orden
      if (!/^\d{4}-\d{2}-\d{2}$/.test(partition)) throw new Error(`Unexpected partition id: ${partition}`);
      await this.client.command({ query: `OPTIMIZE TABLE ${this.database}.otel_traces PARTITION '${partition}' FINAL` });
      this.options.log(`compacted ${partition} (${parts} parts)`);
      done.push(partition);
    }
    if (done.length === 0) this.options.log("no closed partition needs compacting");
    return done;
  }

  private async dropExpiredPrevious(): Promise<boolean> {
    if (this.options.keepPreviousDays <= 0 || !(await this.engine("otel_traces_pre_dedup"))) return false;
    const rows = await this.rows<{ age: string }>(
      `SELECT dateDiff('day', applied_at, now()) AS age FROM ${this.database}.schema_migrations WHERE version = {version:String} LIMIT 1`,
      { version: DONE },
    ).catch(() => []);
    if (rows.length === 0) return false; // el cambio no está marcado como verificado: no se toca
    if (Number(rows[0]!.age) < this.options.keepPreviousDays) return false;
    await this.client.command({ query: `DROP TABLE ${this.database}.otel_traces_pre_dedup SYNC` });
    this.options.log(`dropped otel_traces_pre_dedup (kept ${rows[0]!.age} days)`);
    return true;
  }

  private async engine(table: string): Promise<string | undefined> {
    const rows = await this.rows<{ engine: string }>(`SELECT engine FROM system.tables WHERE database = {database:String} AND name = {table:String}`, { database: this.database, table });
    return rows[0]?.engine;
  }

  private async rows<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    const result = await this.client.query({ query, query_params: params, format: "JSONEachRow" });
    return result.json<T>();
  }
}
