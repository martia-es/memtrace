import type { ClickHouseClient } from "@clickhouse/client";
import { RepositoryUnavailableError } from "@/application/errors";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { Annotation } from "@/domain/annotation";
import type { ScoreDataType } from "@/domain/evaluation";
import { QueryLimiter } from "./query-limiter";

/** Máximo de filas por lectura de acuerdo (ADR-040): unas decenas de miles de etiquetas, muy por encima del uso esperado. */
const AGREEMENT_ROW_LIMIT = 50000;

interface AnnotationRow {
  ServiceName: string;
  TargetType: string;
  TraceId: string;
  SpanId: string;
  DatasetRunId: string;
  ItemIndex: number;
  ConfigId: string;
  ConfigName: string;
  DataType: string;
  AnnotatorId: string;
  Value: string;
  Comment: string | null;
  CreatedAt: string;
  IsDeleted: number;
}

/**
 * Implementación del puerto sobre la tabla `annotations` (ADR-037). Escribe `trace` (ADR-037) y `run_item` (colas, ADR-039); la lectura por traza solo ve `trace`.
 * Toda lectura usa `FINAL` + `IsDeleted = 0`: ReplacingMergeTree deduplica por clave solo al fusionar.
 */
export class ClickHouseAnnotationRepository implements AnnotationRepository {
  private readonly limiter: QueryLimiter;

  constructor(
    private readonly writeClient: ClickHouseClient,
    private readonly readClient: ClickHouseClient,
    private readonly database: string,
    maxConcurrentQueries = 3,
  ) {
    this.limiter = new QueryLimiter(maxConcurrentQueries);
  }

  upsert(serviceName: string, annotation: Annotation): Promise<void> {
    return this.insert(serviceName, annotation, 0);
  }

  retract(serviceName: string, annotation: Annotation): Promise<void> {
    return this.insert(serviceName, annotation, 1);
  }

  async listForTrace(serviceName: string, traceId: string): Promise<Annotation[]> {
    try {
      return await this.limiter.run(async () => {
        const result = await this.readClient.query({
          query: `SELECT * FROM ${this.database}.annotations FINAL
                   WHERE ServiceName = {serviceName:String} AND TargetType = 'trace' AND TraceId = {traceId:String} AND IsDeleted = 0
                   ORDER BY CreatedAt ASC
                   LIMIT 1000`,
          query_params: { serviceName, traceId },
          format: "JSONEachRow",
        });
        return (await result.json<AnnotationRow>()).map(toAnnotation);
      });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (annotations) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  listForRuns(serviceName: string, datasetRunIds: string[], configName?: string): Promise<Annotation[]> {
    if (datasetRunIds.length === 0) return Promise.resolve([]);
    return this.listWhere(
      serviceName,
      "TargetType = 'run_item' AND DatasetRunId IN {datasetRunIds:Array(String)}",
      { datasetRunIds },
      configName,
    );
  }

  listForTraces(serviceName: string, traceIds: string[], configName?: string): Promise<Annotation[]> {
    if (traceIds.length === 0) return Promise.resolve([]);
    return this.listWhere(serviceName, "TargetType = 'trace' AND SpanId = '' AND TraceId IN {traceIds:Array(String)}", { traceIds }, configName);
  }

  /** Lectura acotada para el cálculo de acuerdo: el tope evita traer una tabla entera si el alcance es enorme. */
  private async listWhere(serviceName: string, condition: string, params: Record<string, unknown>, configName?: string): Promise<Annotation[]> {
    try {
      return await this.limiter.run(async () => {
        const result = await this.readClient.query({
          query: `SELECT * FROM ${this.database}.annotations FINAL
                   WHERE ServiceName = {serviceName:String} AND ${condition} AND IsDeleted = 0
                     ${configName === undefined ? "" : "AND ConfigName = {configName:String}"}
                   ORDER BY CreatedAt ASC
                   LIMIT ${AGREEMENT_ROW_LIMIT}`,
          query_params: { serviceName, ...params, ...(configName === undefined ? {} : { configName }) },
          format: "JSONEachRow",
        });
        return (await result.json<AnnotationRow>()).map(toAnnotation);
      });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse query (annotations for agreement) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }

  private async insert(serviceName: string, annotation: Annotation, isDeleted: 0 | 1): Promise<void> {
    const row: AnnotationRow = {
      ServiceName: serviceName,
      TargetType: annotation.datasetRunId ? "run_item" : "trace",
      TraceId: annotation.traceId,
      SpanId: annotation.spanId ?? "",
      DatasetRunId: annotation.datasetRunId ?? "",
      ItemIndex: annotation.itemIndex ?? 0,
      ConfigId: annotation.configId,
      ConfigName: annotation.configName,
      DataType: annotation.dataType,
      AnnotatorId: annotation.annotatorId,
      Value: annotation.value,
      Comment: annotation.comment,
      // DateTime64 en JSONEachRow espera "YYYY-MM-DD HH:MM:SS.mmm", no el "T"/"Z" de toISOString()
      CreatedAt: annotation.createdAt.replace("T", " ").replace("Z", ""),
      IsDeleted: isDeleted,
    };
    try {
      await this.writeClient.insert({ table: `${this.database}.annotations`, values: [row], format: "JSONEachRow" });
    } catch (error) {
      console.error("[memtrace-api] ClickHouse insert (annotations) failed:", error);
      throw new RepositoryUnavailableError(error);
    }
  }
}

function toAnnotation(row: AnnotationRow): Annotation {
  return {
    traceId: row.TraceId,
    spanId: row.SpanId === "" ? null : row.SpanId,
    configId: row.ConfigId,
    configName: row.ConfigName,
    dataType: row.DataType as ScoreDataType,
    annotatorId: row.AnnotatorId,
    value: row.Value,
    comment: row.Comment,
    ...(row.TargetType === "run_item" ? { datasetRunId: row.DatasetRunId, itemIndex: row.ItemIndex } : {}),
    // ClickHouse devuelve "YYYY-MM-DD HH:MM:SS.mmm" sin zona (el servidor corre en UTC, igual que al insertar)
    createdAt: `${row.CreatedAt.replace(" ", "T")}Z`,
  };
}
