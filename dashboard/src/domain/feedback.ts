/** Reglas puras del feedback de usuario final (ADR-062). */
import type { TraceFeedbackResponse } from "@contract";
import { tr } from "./translate";

export type FeedbackTone = "ok" | "error" | "warn" | "neutral";

/** Tono de un conjunto de votos: gana el sentido mayoritario; empate = aviso. */
export function feedbackTone(up: number, down: number): FeedbackTone {
  if (up === 0 && down === 0) return "neutral";
  if (up === down) return "warn";
  return up > down ? "ok" : "error";
}

export function alignmentLabel(alignment: TraceFeedbackResponse["alignment"]): string | null {
  if (alignment === "aligned") return tr("feedback.matches_the_reviewers");
  if (alignment === "misaligned") return tr("feedback.disagrees_with_the_reviewers");
  return null;
}

/** «87%» a partir del % de 👍 (0-100); «–» sin votos. */
export function formatSatisfaction(satisfaction: number | null): string {
  return satisfaction === null ? "–" : `${Math.round(satisfaction)}%`;
}
