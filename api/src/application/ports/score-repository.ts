import type { DatasetRunItemResult, DatasetRunItemSubmission, ScoreAggregate } from "@/domain/evaluation";

/** Puerto hacia el almacén de scores (ClickHouse, ver ADR-028). Separado de `TraceRepository`
 * a propósito: es el único puerto de la API con permiso de escritura (ver `client.ts`). */
export interface ScoreRepository {
  insertScores(serviceName: string, datasetRunId: string, items: DatasetRunItemSubmission[]): Promise<void>;
  listScoresByRun(serviceName: string, datasetRunId: string): Promise<DatasetRunItemResult[]>;
  /** Una fila por (run, nombre de evaluador) entre los runs pedidos. Un solo round-trip para N runs. */
  aggregateForRuns(serviceName: string, datasetRunIds: string[]): Promise<ScoreAggregate[]>;
}
