/** Resultado de evaluación offline (ADR-028): vive en ClickHouse, no en PostgreSQL (ver `scores` table). */

export type ScoreDataType = "numeric" | "boolean" | "categorical";
export type ScoreSource = "human" | "code" | "llm_judge";

export interface Score {
  name: string;
  value: string;
  dataType: ScoreDataType;
  source: ScoreSource;
  comment: string | null;
  /** Identidad del juez de un score `llm_judge` (ADR-043). Ausente/null en cualquier otro origen y en scores anteriores. */
  judgeModel?: string | null;
  judgePromptHash?: string | null;
}

/** Una fila de `dataset_run`, tal como la sube el SDK (ver `eval_api_client.py::_serialize_item`). */
export interface DatasetRunItemSubmission {
  /** Posición del item en el run; si falta, la deduce el servidor (`startIndex` + posición en el lote). ADR-034. */
  itemIndex?: number;
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
/** Identidad de un juez tal como quedó registrada en sus scores (ADR-043). `null` = no registrada. */
export interface ScoreJudge {
  model: string | null;
  promptHash: string | null;
}

export interface ScoreAggregate {
  datasetRunId: string;
  name: string;
  dataType: ScoreDataType;
  passRate: number | null;
  average: number | null;
  count: number;
  /** Identidades distintas de juez entre los scores `llm_judge` de este (run, evaluador); vacío si no hay ninguno.
   * Más de una = el run mezcla jueces (p. ej. un reenvío con el juez cambiado) o scores anteriores a ADR-043. */
  judges: ScoreJudge[];
}
