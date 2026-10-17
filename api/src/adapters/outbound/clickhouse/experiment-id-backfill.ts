import type { ClickHouseClient } from "@clickhouse/client";

/**
 * Asigna el experimento a las filas anteriores a la migración 013 (ADR-088). Solo se asigna cuando el `ServiceName`
 * pertenece a UN experimento: si dos organizaciones lo comparten no hay forma de saber de quién es cada fila, y se
 * dejan sin asignar (ningún tenant las ve) para que alguien decida. No adivina.
 */
export interface ExperimentRef {
  id: string;
  serviceName: string;
}

export interface BackfillPlan {
  assign: ExperimentRef[];
  /** nombres de servicio compartidos por más de un experimento: sus filas anteriores no se pueden atribuir */
  ambiguous: Array<{ serviceName: string; experimentIds: string[] }>;
}

export function planBackfill(experiments: ExperimentRef[]): BackfillPlan {
  const byService = new Map<string, string[]>();
  for (const e of experiments) byService.set(e.serviceName, [...(byService.get(e.serviceName) ?? []), e.id]);
  const assign: ExperimentRef[] = [];
  const ambiguous: BackfillPlan["ambiguous"] = [];
  for (const [serviceName, ids] of byService) {
    if (ids.length === 1) assign.push({ id: ids[0]!, serviceName });
    else ambiguous.push({ serviceName, experimentIds: ids });
  }
  return { assign, ambiguous };
}

export interface BackfillCount {
  table: string;
  serviceName: string;
  rows: number;
}

/**
 * `otel_traces` en su versión original: ExperimentId es una columna DEFAULT fuera de la clave, así que se actualiza en sitio. Desde la
 * migración a ReplacingMergeTree (ADR-099) el experimento está en la clave de ordenación y se trata como las demás (copia y borrado):
 * `tablesByStrategy` lo decide mirando la clave real, no una suposición.
 */
const UPDATE_TABLES = ["otel_traces"];
/** Tablas con el experimento en la clave de ordenación: no admiten UPDATE, se copian con el valor y se borra el original. */
const COPY_TABLES = ["eval_items", "eval_scores", "eval_run_summaries", "annotations", "user_feedback"];
const SYNC = { mutations_sync: "2" as const };

/** Idempotente: repetirlo no duplica nada (la copia usa la misma clave y las filas ya asignadas no cumplen `ExperimentId = ''`). */
export class ExperimentIdBackfill {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly database: string,
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) throw new Error(`Invalid database name: ${database}`);
  }

  /** Qué tablas se actualizan en sitio y cuáles se copian: el experimento en la clave de ordenación no admite UPDATE. */
  private async tablesByStrategy(): Promise<{ update: string[]; copy: string[] }> {
    const result = await this.client.query({
      query: `SELECT sorting_key FROM system.tables WHERE database = {database:String} AND name = 'otel_traces'`,
      query_params: { database: this.database },
      format: "JSONEachRow",
    });
    const key = (await result.json<{ sorting_key: string }>())[0]?.sorting_key ?? "";
    return key.includes("ExperimentId") ? { update: [], copy: ["otel_traces", ...COPY_TABLES] } : { update: UPDATE_TABLES, copy: COPY_TABLES };
  }

  async run(assign: ExperimentRef[]): Promise<BackfillCount[]> {
    const counts: BackfillCount[] = [];
    const { update, copy } = await this.tablesByStrategy();
    for (const experiment of assign) {
      for (const table of update) {
        const rows = await this.pending(table, experiment.serviceName);
        if (rows === 0) continue;
        await this.client.command({
          query: `ALTER TABLE ${this.database}.${table} UPDATE ExperimentId = {experimentId:String} WHERE ServiceName = {serviceName:String} AND ExperimentId = ''`,
          query_params: { experimentId: experiment.id, serviceName: experiment.serviceName },
          clickhouse_settings: SYNC,
        });
        counts.push({ table, serviceName: experiment.serviceName, rows });
      }
      for (const table of copy) {
        const rows = await this.pending(table, experiment.serviceName);
        if (rows === 0) continue;
        const columns = (await this.columns(table)).map((c) => `\`${c}\``);
        await this.client.command({
          query: `INSERT INTO ${this.database}.${table} (${columns.join(", ")}, ExperimentId)
                  SELECT ${columns.join(", ")}, {experimentId:String} FROM ${this.database}.${table}
                   WHERE ServiceName = {serviceName:String} AND ExperimentId = ''`,
          query_params: { experimentId: experiment.id, serviceName: experiment.serviceName },
        });
        await this.client.command({
          query: `ALTER TABLE ${this.database}.${table} DELETE WHERE ServiceName = {serviceName:String} AND ExperimentId = ''`,
          query_params: { serviceName: experiment.serviceName },
          clickhouse_settings: SYNC,
        });
        counts.push({ table, serviceName: experiment.serviceName, rows });
      }
    }
    return counts;
  }

  /** Filas sin asignar de cada tabla (para informar de lo que queda tras el backfill). */
  async unassigned(): Promise<Array<{ table: string; serviceName: string; rows: number }>> {
    const out: Array<{ table: string; serviceName: string; rows: number }> = [];
    for (const table of [...UPDATE_TABLES, ...COPY_TABLES].filter((t, i, all) => all.indexOf(t) === i)) {
      const result = await this.client.query({
        query: `SELECT ServiceName AS serviceName, count() AS rows FROM ${this.database}.${table} WHERE ExperimentId = '' GROUP BY ServiceName ORDER BY ServiceName`,
        format: "JSONEachRow",
      });
      for (const r of await result.json<{ serviceName: string; rows: string }>()) out.push({ table, serviceName: r.serviceName, rows: Number(r.rows) });
    }
    return out;
  }

  private async pending(table: string, serviceName: string): Promise<number> {
    const result = await this.client.query({
      query: `SELECT count() AS rows FROM ${this.database}.${table} WHERE ServiceName = {serviceName:String} AND ExperimentId = ''`,
      query_params: { serviceName },
      format: "JSONEachRow",
    });
    return Number((await result.json<{ rows: string }>())[0]?.rows ?? 0);
  }

  private async columns(table: string): Promise<string[]> {
    const result = await this.client.query({
      query: `SELECT name FROM system.columns WHERE database = {database:String} AND table = {table:String} AND name != 'ExperimentId' AND default_kind NOT IN ('MATERIALIZED', 'ALIAS') ORDER BY position`,
      query_params: { database: this.database, table },
      format: "JSONEachRow",
    });
    return (await result.json<{ name: string }>()).map((r) => r.name);
  }
}
