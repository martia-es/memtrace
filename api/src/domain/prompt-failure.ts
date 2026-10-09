import type { PromptRef } from "./trace";

/**
 * Por qué una traza de un prompt cuenta como fallo que se puede arreglar (ADR-077). Cuatro señales que ya existen en
 * MemTrace, ninguna nueva: un paso falló, un evaluador la puntuó mal, una persona de negocio la valoró mal o el usuario
 * final votó 👎.
 */
export type FailureReason = "error" | "low_score" | "human_low" | "user_dislike";

export const FAILURE_REASONS: FailureReason[] = ["error", "low_score", "human_low", "user_dislike"];

/** Una traza de un prompt con al menos un motivo de fallo, lista para elegirla y arreglarla. */
export interface PromptFailure {
  traceId: string;
  startTimeUs: number;
  input: string | null;
  output: string | null;
  /** mensaje de error del span raíz, si la traza falló */
  error: string | null;
  prompts: PromptRef[];
  /** en el orden de `FAILURE_REASONS`, sin repetir */
  reasons: FailureReason[];
}

/**
 * Un score automático cuenta como bajo si es un «No» (`boolean`) o un número por debajo de 0,5 (`numeric`, la escala 0-1
 * de los evaluadores integrados y de los jueces). Los categóricos no tienen orden, así que nunca cuentan.
 */
export function isLowScore(score: { dataType: string; value: string }): boolean {
  if (score.dataType === "boolean") return score.value === "false";
  if (score.dataType !== "numeric") return false;
  const value = Number(score.value);
  return Number.isFinite(value) && value >= 0 && value <= 1 && value < 0.5;
}

/** Los motivos de una traza, en un orden estable. Vacío = no es un fallo. */
export function reasonsOf(signals: Record<FailureReason, boolean>): FailureReason[] {
  return FAILURE_REASONS.filter((r) => signals[r]);
}
