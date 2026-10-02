/** Resultado de evaluación offline (ADR-028): vive en ClickHouse, no en PostgreSQL (ver `scores` table). */

export type ScoreDataType = "numeric" | "boolean" | "categorical";
export type ScoreSource = "human" | "code" | "llm_judge";

export interface Score {
  name: string;
  value: string;
  dataType: ScoreDataType;
  source: ScoreSource;
  comment: string | null;
}

/** Una fila de `dataset_run`, tal como la sube el SDK (ver `eval_api_client.py::_serialize_item`). */
export interface DatasetRunItemSubmission {
  input: unknown;
  expectedOutput: unknown;
  output: unknown;
  traceId: string | null;
  error: string | null;
  scores: Score[];
}

/** Una fila leída de vuelta de ClickHouse para mostrar el detalle de una ejecución. */
export interface DatasetRunItemResult extends DatasetRunItemSubmission {
  itemIndex: number;
}

/** Resumen de un evaluador sobre un run entero: cuenta como "aprobado" el `passRate` de un
 * booleano, o la `average` de un numérico. Ambos `null` si `dataType` es `categorical` (sin
 * agregación definida todavía) o si no hay filas de ese tipo. */
export interface ScoreAggregate {
  datasetRunId: string;
  name: string;
  dataType: ScoreDataType;
  passRate: number | null;
  average: number | null;
  count: number;
}
