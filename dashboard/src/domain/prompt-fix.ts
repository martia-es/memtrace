import type { PromptVersionDto, SpanNodeDto } from "@contract";
import { tr, lazyMessages } from "./translate";

/**
 * Arreglar un prompt a partir de un fallo (ADR-072): qué falló en una traza y desde qué versión partir. Reglas puras de
 * presentación; la propuesta del arreglo la escribe una persona (o una herramienta del equipo con su propio LLM) y siempre
 * queda como borrador.
 */

export interface Failure {
  /** el paso que falló, el más profundo de su rama (el error que arrastró a los demás) */
  step: string;
  message: string;
}

const MAX_MESSAGE = 300;

function messageOf(node: SpanNodeDto): string {
  const status = node.status.message?.trim();
  if (status) return status;
  const exception = node.events.find((e) => e.name === "exception");
  const detail = exception?.attributes["exception.message"] ?? exception?.attributes["exception.type"];
  return detail?.trim() || tr("prompt-fix.the_step_failed_without_a_message");
}

/** El fallo de una traza: el primer span fallido que no tiene un hijo fallido (los de arriba solo propagan el error). */
export function failureOf(roots: SpanNodeDto[]): Failure | null {
  const visit = (node: SpanNodeDto): SpanNodeDto | null => {
    // un padre correcto con un hijo fallido es el caso habitual (el agente responde aunque una tool falle): se baja igualmente
    for (const child of node.children) {
      const deeper = visit(child);
      if (deeper) return deeper;
    }
    return node.status.code === "error" ? node : null;
  };
  for (const root of roots) {
    const found = visit(root);
    if (found) return { step: found.name, message: messageOf(found).slice(0, MAX_MESSAGE) };
  }
  return null;
}

/** La versión desde la que se arregla: la que usó la traza si sigue existiendo y está publicada; si no, la seleccionada o la última publicada. */
export function baseVersionFor(versions: PromptVersionDto[], usedByTrace: number | null, selected: number | null): PromptVersionDto | null {
  const published = versions.filter((v) => v.status === "published");
  return (
    published.find((v) => v.version === usedByTrace) ??
    published.find((v) => v.version === selected) ??
    published[0] ??
    null
  );
}

/** El motivo que se propone al guardar el borrador: el fallo, sin que nadie tenga que escribirlo. */
export function defaultRationale(failure: Failure | null): string {
  return failure ? tr("prompt-fix.fixes_a_failure_in_step_message", { step: failure.step, message: failure.message }) : "";
}

export type FailureReason = "error" | "low_score" | "human_low" | "user_dislike";

/** Cómo se llama cada motivo de fallo para quien arregla el prompt (ADR-077). */
export const FAILURE_REASON_LABELS: Record<FailureReason, string> = lazyMessages({
  error: "prompt-fix.error",
  low_score: "prompt-fix.low_score",
  human_low: "prompt-fix.reviewer_said_no",
  user_dislike: "prompt-fix.from_user",
});
export const FAILURE_REASONS = Object.keys(FAILURE_REASON_LABELS) as FailureReason[];
