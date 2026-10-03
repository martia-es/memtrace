import type { TraceScore } from "@/domain/annotation";
import type { DatasetRunItemResult, DatasetRunItemSubmission, ScoreAggregate, ScoreDataType } from "@/domain/evaluation";

/** Puerto hacia el almacén de scores (ClickHouse, ver ADR-028). Separado de `TraceRepository`
 * a propósito: es el único puerto de la API con permiso de escritura (ver `client.ts`). */
export interface ScoreRepository {
  /** Cada item usa su `itemIndex`, o `startIndex` + su posición en el lote si no lo trae: la tabla es ReplacingMergeTree por
   * (run, ItemIndex, Name), así que reenviar el mismo lote es idempotente (ADR-034). */
  insertScores(serviceName: string, datasetRunId: string, items: DatasetRunItemSubmission[], startIndex?: number): Promise<void>;
  listScoresByRun(serviceName: string, datasetRunId: string): Promise<DatasetRunItemResult[]>;
  /** Una fila por (run, nombre de evaluador) entre los runs pedidos. Un solo round-trip para N runs. */
  aggregateForRuns(serviceName: string, datasetRunIds: string[]): Promise<ScoreAggregate[]>;
  /** Scores automáticos ligados a una traza (`scores.TraceId`), para mostrarlos junto a las anotaciones humanas (ADR-037). */
  listScoresByTrace(serviceName: string, traceId: string): Promise<TraceScore[]>;
  /** Scores `llm_judge` de esos runs (con la identidad del juez), para medir su acuerdo con las etiquetas humanas (ADR-040). `name` filtra por evaluador. */
  listJudgeScoresForRuns(serviceName: string, datasetRunIds: string[], name?: string): Promise<JudgeScoreRow[]>;
}

/** Un score `llm_judge` aislado de su item, tal como lo necesita el cálculo de acuerdo. */
export interface JudgeScoreRow {
  datasetRunId: string;
  itemIndex: number;
  name: string;
  value: string;
  dataType: ScoreDataType;
  judgeModel: string | null;
  judgePromptHash: string | null;
}
