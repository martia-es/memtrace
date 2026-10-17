import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Cambia `otel_traces` (MergeTree) por su versión sin duplicados (ReplacingMergeTree, migración 017, ADR-099) sin parar la
 * ingesta ni perder spans, y se puede repetir:
 *
 *  1. copia el histórico, día a día, a `otel_traces_v2`;
 *  2. quita las vistas materializadas que leen de `otel_traces`, intercambia las dos tablas (EXCHANGE, atómico) y recrea las
 *     vistas sobre la nueva; la antigua queda como `otel_traces_pre_dedup` por si hay que volver atrás;
 *  3. recoge lo que llegó mientras tanto: copia de la antigua a la nueva las últimas `catchupHours` horas (y rellena el índice
 *     de trazas de lo que se escribió con la vista ausente).
 *
 * Lo que hace seguro no pararse a esperar es que las copias SE SOLAPAN a propósito: copiar dos veces el mismo span no duplica
 * nada, porque la tabla nueva funde las copias. Por eso el paso 3 puede repetirse hasta que cuadre.
 */
export interface DedupeOptions {
  /** Cuánto hacia atrás, desde el inicio de la copia, se recoge de la tabla antigua tras el intercambio. */
  catchupHours: number;
  /** Espera tras el intercambio para que terminen las inserciones asíncronas que aún apuntaban a la tabla antigua. */
  settleMs: number;
  /** Tope de filas por orden INSERT ... SELECT: más allá, la hora se parte en trozos por hash de TraceId. */
  maxRowsPerChunk: number;
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Ajustes de cada copia. Recalcular las columnas MATERIALIZED (conversación, usuario, prompt...) de un bloque grande consume mucha
 * memoria: una copia de un día entero agotó los 2,7 GB de un ClickHouse de 3 GB. Con bloques pequeños y pocos hilos el consumo es
 * pequeño y constante, a costa de algo de tiempo.
 */
const COPY_SETTINGS = { max_insert_block_size: "65536", min_insert_block_size_rows: "65536", min_insert_block_size_bytes: "33554432", max_threads: "2" } as const;

export type DedupeStatus = "already-deduplicated" | "completed" | "resumed";

export interface DedupeReport {
  status: DedupeStatus;
  copiedDays: number;
  /** spans distintos de la ventana recogida en la tabla antigua y en la nueva (deben coincidir al final) */
  windowSpans: { old: number; new: number };
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Marca en `schema_migrations` de que el cambio terminó (intercambio y recogida verificados): evita repetir la recogida en cada ejecución. */
const DONE = "dedupe-otel-traces";
const KEY = "ServiceName, ExperimentId, TraceId, SpanId";

export class OtelTracesDedupe {
  private readonly options: DedupeOptions;

  constructor(
    private readonly client: ClickHouseClient,
    private readonly database: string,
    options: Partial<DedupeOptions> = {},
  ) {
    if (!NAME.test(database)) throw new Error(`Invalid database name: ${database}`);
    this.options = {
      catchupHours: 24,
      settleMs: 10_000,
      maxRowsPerChunk: 500_000,
      log: (m) => console.log(`[dedupe] ${m}`),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
  }

  async run(): Promise<DedupeReport> {
    const { log } = this.options;
    const live = await this.table("otel_traces");
    if (!live) throw new Error("otel_traces does not exist: run the ClickHouse migrations first");
    const old = await this.table("otel_traces_pre_dedup");

    if (live.engine === "ReplacingMergeTree") {
      if (!old || (await this.isDone())) {
        log("otel_traces is already a ReplacingMergeTree: nothing to do");
        return { status: "already-deduplicated", copiedDays: 0, windowSpans: { old: 0, new: 0 } };
      }
      log("the swap was done before but the catch-up was not verified: running it again (it is idempotent)");
      const windowSpans = await this.catchUp("otel_traces_pre_dedup", new Date(Date.now()));
      await this.markDone();
      return { status: "resumed", copiedDays: 0, windowSpans };
    }

    const next = await this.table("otel_traces_v2");
    if (!next) throw new Error("otel_traces_v2 does not exist: migration 017 has not run yet");
    for (const column of ["ExperimentId", "TraceId", "SpanId"]) {
      if (!next.sortingKey.includes(column)) throw new Error(`otel_traces_v2 does not have ${column} in its sorting key (${next.sortingKey}): refusing to swap`);
    }

    const started = await this.serverNow();
    const copiedDays = await this.copyHistory();

    // 2. intercambio. Las vistas se guardan antes de quitarlas: se recrean tal cual, apuntando a la tabla nueva.
    const views = await this.dependentViews();
    for (const v of views) await this.command(`DROP VIEW IF EXISTS ${this.database}.${v.name}`);
    await this.command(`EXCHANGE TABLES ${this.database}.otel_traces AND ${this.database}.otel_traces_v2`);
    await this.command(`RENAME TABLE ${this.database}.otel_traces_v2 TO ${this.database}.otel_traces_pre_dedup`);
    for (const v of views) await this.command(v.createQuery);
    log(`swapped: otel_traces is now a ReplacingMergeTree; the previous table is otel_traces_pre_dedup (${views.length} materialized view(s) recreated)`);

    // 3. lo que llegó durante la copia y lo que aún escribían las inserciones asíncronas hacia la tabla antigua
    await this.options.sleep(this.options.settleMs);
    const windowSpans = await this.catchUp("otel_traces_pre_dedup", started);
    await this.markDone();
    return { status: "completed", copiedDays, windowSpans };
  }

  /**
   * Borra la tabla antigua (`otel_traces_pre_dedup`), que ocupa disco y se conserva por si hay que volver atrás. Solo si el cambio
   * terminó y se verificó.
   */
  async dropPrevious(): Promise<boolean> {
    if (!(await this.isDone())) throw new Error("the swap has not been completed and verified: refusing to drop the previous table");
    if (!(await this.table("otel_traces_pre_dedup"))) return false;
    await this.command(`DROP TABLE ${this.database}.otel_traces_pre_dedup SYNC`);
    this.options.log("dropped otel_traces_pre_dedup");
    return true;
  }

  private async isDone(): Promise<boolean> {
    if (!(await this.table("schema_migrations"))) return false;
    return (await this.count(`SELECT count() AS n FROM ${this.database}.schema_migrations WHERE version = {version:String}`, { version: DONE })) > 0;
  }

  private async markDone(): Promise<void> {
    // la misma definición que crea el Job de migraciones: si aún no existiera, se crea igual
    await this.command(`CREATE TABLE IF NOT EXISTS ${this.database}.schema_migrations (version String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY version`);
    await this.command(`INSERT INTO ${this.database}.schema_migrations (version) VALUES ({version:String})`, { version: DONE });
  }

  private async copyHistory(): Promise<number> {
    const days = await this.rows<{ d: string }>(`SELECT toString(toDate(Timestamp)) AS d FROM ${this.database}.otel_traces GROUP BY d ORDER BY d`);
    this.options.log(`copying ${days.length} day(s) of history to otel_traces_v2, in chunks of at most ${this.options.maxRowsPerChunk} rows`);
    for (const { d } of days) {
      const rows = await this.copyRange("otel_traces", "otel_traces_v2", "toDate(Timestamp) = {d:Date}", { d });
      this.options.log(`  ${d}: ${rows} rows`);
    }
    return days.length;
  }

  /**
   * Copia `where` de `from` a `to` por horas y, si una hora tiene más de `maxRowsPerChunk` filas, por trozos según el hash de TraceId.
   * Cada orden es pequeña (memoria acotada) y, como las copias se solapan sin daño, repetir una es seguro.
   */
  private async copyRange(from: string, to: string, where: string, params: Record<string, unknown>): Promise<number> {
    const hours = await this.rows<{ h: string; n: string }>(
      `SELECT toString(toStartOfHour(Timestamp)) AS h, count() AS n FROM ${this.database}.${from} WHERE ${where} GROUP BY h ORDER BY h`,
      params,
    );
    let copied = 0;
    for (const { h, n } of hours) {
      const count = Number(n);
      const chunks = Math.max(1, Math.ceil(count / this.options.maxRowsPerChunk));
      for (let k = 0; k < chunks; k++) {
        await this.command(
          `INSERT INTO ${this.database}.${to} SELECT * FROM ${this.database}.${from} WHERE ${where} AND toStartOfHour(Timestamp) = toDateTime({h:String})${chunks > 1 ? " AND cityHash64(TraceId) % {chunks:UInt32} = {k:UInt32}" : ""}`,
          { ...params, h, chunks, k },
          COPY_SETTINGS,
        );
      }
      copied += count;
    }
    return copied;
  }

  /**
   * Copia de la tabla antigua a la nueva la ventana reciente y comprueba que no falta ningún span; si falta alguno, repite (hasta
   * 3 veces). Rellena además el índice de trazas de lo escrito mientras la vista no estaba.
   */
  private async catchUp(oldTable: string, since: Date): Promise<{ old: number; new: number }> {
    const window = { since: since.toISOString().replace("T", " ").replace("Z", ""), hours: this.options.catchupHours };
    const where = `Timestamp >= toDateTime64({since:String}, 9) - INTERVAL {hours:UInt32} HOUR`;
    let counts = { old: 0, new: 0 };
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.copyRange(oldTable, "otel_traces", where, window);
      counts = {
        old: await this.count(`SELECT uniqExact(${KEY}) AS n FROM ${this.database}.${oldTable} WHERE ${where}`, window),
        new: await this.count(`SELECT uniqExact(${KEY}) AS n FROM ${this.database}.otel_traces WHERE ${where}`, window),
      };
      if (counts.new >= counts.old) break;
      this.options.log(`catch-up attempt ${attempt}: ${counts.old - counts.new} span(s) missing in the new table, retrying`);
      await this.options.sleep(this.options.settleMs);
    }
    if (counts.new < counts.old) throw new Error(`the new table still misses ${counts.old - counts.new} span(s) of the window after 3 attempts: the previous table was kept as ${oldTable}`);
    // el índice de trazas: min/max por traza; repetir filas no cambia el resultado
    if (await this.table("otel_traces_trace_id_ts")) {
      await this.command(
        `INSERT INTO ${this.database}.otel_traces_trace_id_ts SELECT TraceId, min(Timestamp) AS Start, max(Timestamp) AS End FROM ${this.database}.otel_traces WHERE TraceId != '' AND ${where} GROUP BY TraceId`,
        window,
      );
    }
    this.options.log(`catch-up done: ${counts.new} distinct span(s) in the last ${this.options.catchupHours} h of the window (${counts.old} in the previous table)`);
    return counts;
  }

  private async dependentViews(): Promise<Array<{ name: string; createQuery: string }>> {
    const views = await this.rows<{ name: string; create_table_query: string }>(
      `SELECT name, create_table_query FROM system.tables WHERE database = {database:String} AND engine = 'MaterializedView'`,
      { database: this.database },
    );
    const source = new RegExp(`\\bFROM\\s+(${this.database}\\.)?otel_traces\\b`, "i");
    return views.filter((v) => source.test(v.create_table_query)).map((v) => ({ name: v.name, createQuery: v.create_table_query }));
  }

  private async table(name: string): Promise<{ engine: string; sortingKey: string } | undefined> {
    const rows = await this.rows<{ engine: string; sorting_key: string }>(
      `SELECT engine, sorting_key FROM system.tables WHERE database = {database:String} AND name = {name:String}`,
      { database: this.database, name },
    );
    return rows[0] ? { engine: rows[0].engine, sortingKey: rows[0].sorting_key } : undefined;
  }

  private async serverNow(): Promise<Date> {
    const [row] = await this.rows<{ now: string }>(`SELECT toString(now64(3)) AS now`);
    return new Date(row!.now.replace(" ", "T") + "Z");
  }

  private async count(query: string, params: Record<string, unknown>): Promise<number> {
    const [row] = await this.rows<{ n: string }>(query, params);
    return Number(row?.n ?? 0);
  }

  private async rows<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const result = await this.client.query({ query, query_params: params, format: "JSONEachRow" });
    return result.json<T>();
  }

  private async command(query: string, params: Record<string, unknown> = {}, settings?: Record<string, string>): Promise<void> {
    await this.client.command({ query, query_params: params, ...(settings ? { clickhouse_settings: settings } : {}) });
  }
}
