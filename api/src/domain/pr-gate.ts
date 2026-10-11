import type { GateFailure, GateResult } from "./deploy-gate";

/**
 * Gate de evaluación en el PR (ADR-064, fase 3): traduce el veredicto del gate de despliegue a un check run de GitHub.
 * Puro: no sabe de HTTP ni de la base de datos.
 */

/** Nombre del check; es el que una regla de rama marca como obligatorio. */
export const PR_CHECK_NAME = "memtrace/eval-gate";

export interface CheckPayload {
  name: string;
  sha: string;
  status: "in_progress" | "completed";
  /** solo con `status: "completed"` */
  conclusion?: "success" | "failure";
  title: string;
  /** Markdown */
  summary: string;
  detailsUrl: string | null;
}

const percent = (value: number | null): string => (value === null ? "no data" : `${Math.round(value * 1000) / 10}%`);

function failureLine(f: GateFailure): string {
  if (f.incomplete) return `- **${f.evaluator}**: only ${f.incomplete.scored} of ${f.incomplete.items} items were scored, so its pass rate says nothing about the run`;
  return `- **${f.evaluator}**: ${percent(f.passRate)}, target ${percent(f.target)}`;
}

/**
 * Check que corresponde al veredicto del gate, o `null` si no hay nada que publicar: sin evaluación del commit todavía
 * (el check aparece en cuanto empiece una) o solo con runs hechos con cambios sin commitear (no representan al commit).
 */
export function checkFromGate(result: GateResult, detailsUrl: string | null): CheckPayload | null {
  const base = { name: PR_CHECK_NAME, sha: result.sha, detailsUrl };
  switch (result.verdict) {
    case "allowed":
      return { ...base, status: "completed", conclusion: "success", title: "Evaluation passed", summary: result.reason };
    case "rollback":
      return { ...base, status: "completed", conclusion: "success", title: "Commit already deployed", summary: result.reason };
    case "evaluation_running":
      return { ...base, status: "in_progress", title: "Evaluation running", summary: result.reason };
    case "failed": {
      const lines = (result.runs[0]?.failures ?? []).map(failureLine);
      return { ...base, status: "completed", conclusion: "failure", title: "Evaluation did not reach its targets", summary: [result.reason, "", ...lines].join("\n").trim() };
    }
    case "insufficient_runs":
      return { ...base, status: "completed", conclusion: "failure", title: "More evaluation runs needed", summary: result.reason };
    case "no_evaluation":
    case "only_dirty_runs":
      return null;
  }
}
