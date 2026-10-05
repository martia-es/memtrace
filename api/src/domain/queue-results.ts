/** Resultados de una cola para el perfil técnico (ADR-050): etiquetas por revisor, desacuerdos y resoluciones. Lógica pura, sin I/O. */
import type { ScoreDataType } from "@/domain/evaluation";

/** Dos valoraciones numéricas que difieren en más de esto cuentan como desacuerdo (misma regla que ADR-040). */
export const NUMERIC_DISAGREEMENT_THRESHOLD = 1;

/** Decisión del técnico sobre un criterio de un item: capa aparte, nunca sustituye a las etiquetas de los revisores. */
export interface QueueResolution {
  queueItemId: string;
  configId: string;
  /** Valor final, serializado como `Score.value`. */
  value: string;
  /** Respuesta correcta que escribe el técnico (ADR-038: un veredicto dice qué está mal, no qué es lo correcto). */
  expectedOutput: string | null;
  resolvedBy: string;
  resolvedAt: string;
}

export interface ResultLabel {
  userId: string;
  value: string;
  comment: string | null;
  createdAt: string;
}

export type CriterionStatus = "no_labels" | "consensus" | "disagreement";

/**
 * ¿Discrepan los revisores? Con una sola etiqueta (o ninguna) no hay desacuerdo. Categóricas y booleanas: valores
 * distintos. Numéricas: rango mayor que `NUMERIC_DISAGREEMENT_THRESHOLD`. Compartida por la vista de resultados y por
 * la promoción para que ambas coincidan en qué es un desacuerdo.
 */
export function hasDisagreement(dataType: ScoreDataType, values: string[]): boolean {
  if (values.length < 2) return false;
  if (dataType === "numeric") {
    const numbers = values.map(Number).filter(Number.isFinite);
    if (numbers.length < 2) return false;
    return Math.max(...numbers) - Math.min(...numbers) > NUMERIC_DISAGREEMENT_THRESHOLD;
  }
  return new Set(values).size > 1;
}

export function criterionStatus(dataType: ScoreDataType, labels: ResultLabel[]): CriterionStatus {
  if (labels.length === 0) return "no_labels";
  return hasDisagreement(dataType, labels.map((l) => l.value)) ? "disagreement" : "consensus";
}

/**
 * Valor que entra en el dataset para un criterio: la resolución del técnico si existe; si no, el valor común de
 * los revisores (categórica/booleana unánime, o la mediana en numéricas sin desacuerdo); null si hay desacuerdo sin
 * resolver o nadie etiquetó.
 */
export function effectiveValue(dataType: ScoreDataType, labels: ResultLabel[], resolution: Pick<QueueResolution, "value"> | undefined): string | null {
  if (resolution) return resolution.value;
  if (criterionStatus(dataType, labels) !== "consensus") return null;
  if (dataType !== "numeric") return labels[0]!.value;
  const sorted = labels.map((l) => Number(l.value)).sort((a, b) => a - b);
  return String(sorted[Math.floor(sorted.length / 2)]);
}
