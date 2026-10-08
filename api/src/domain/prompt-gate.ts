import { ValidationError } from "./errors";
import { describeFailure, judgeRun, type GateRun, type GateRunResult } from "./deploy-gate";

/**
 * Gate de promoción de prompts (ADR-070): una versión solo llega a un entorno protegido si una evaluación offline
 * exitosa de esa misma versión lo respalda. Reglas puras: el servicio reúne los datos y esta función decide. Reutiliza
 * el criterio del gate de despliegue (ADR-064/060): un run pasa si todos sus evaluadores booleanos alcanzan su objetivo.
 */

export const MIN_REQUIRED_RUNS = 1;
export const MAX_REQUIRED_RUNS = 10;
export const DEFAULT_POLICY_RUNS = 1;

export interface PromptPolicy {
  promptId: string;
  /** dataset contra el que se evalúa; null si se borró: la política queda incompleta y bloquea */
  datasetId: string | null;
  requiredRuns: number;
  updatedBy: string | null;
  updatedAt: string;
}

export type PromptGateVerdict =
  /** el entorno no está protegido (el primero por posición, dev) o se está quitando el tag */
  | "not_gated"
  /** el prompt no tiene política: todo se mueve libremente */
  | "no_policy"
  /** esta versión ya estuvo en este entorno sin saltarse el gate: volver a ella no exige evaluar de nuevo */
  | "rollback"
  /** la política perdió su dataset: no se puede evaluar nada, así que no se abre sola */
  | "policy_incomplete"
  | "no_evaluation"
  | "evaluation_running"
  | "failed"
  | "insufficient_runs"
  | "allowed";

export interface PromptGateResult {
  allowed: boolean;
  verdict: PromptGateVerdict;
  tag: string;
  version: number;
  requiredRuns: number;
  /** runs completos de esta versión que se miraron, el más reciente primero */
  runs: GateRunResult[];
  reason: string;
}

/** Entornos que exigen política: todos menos el primero por posición (dev), donde se itera libremente. */
export function gatedEnvironments(environmentKeysByPosition: readonly string[]): string[] {
  return environmentKeysByPosition.slice(1);
}

export function validateRequiredRuns(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_REQUIRED_RUNS || value > MAX_REQUIRED_RUNS) {
    throw new ValidationError("Invalid number of runs", { requiredRuns: `A whole number from ${MIN_REQUIRED_RUNS} to ${MAX_REQUIRED_RUNS}` });
  }
  return value;
}

export function evaluatePromptGate(input: {
  tag: string;
  version: number;
  /** claves de entorno protegidas (`gatedEnvironments`) */
  gated: readonly string[];
  policy: PromptPolicy | null;
  /** el tag ya apuntó a esta versión sin que nadie se saltara el gate */
  previouslyServed: boolean;
  /** runs de ESTA versión contra el dataset de la política (la atribución la hace el servicio) */
  runs: GateRun[];
  targets?: ReadonlyMap<string, number>;
}): PromptGateResult {
  const requiredRuns = input.policy?.requiredRuns ?? DEFAULT_POLICY_RUNS;
  const result = (verdict: PromptGateVerdict, reason: string, runs: GateRunResult[] = []): PromptGateResult => ({
    allowed: verdict === "allowed" || verdict === "rollback" || verdict === "not_gated" || verdict === "no_policy",
    verdict,
    tag: input.tag,
    version: input.version,
    requiredRuns,
    runs,
    reason,
  });

  if (!input.gated.includes(input.tag)) return result("not_gated", `"${input.tag}" is not a protected environment.`);
  if (!input.policy) return result("no_policy", "This prompt has no promotion policy, so any version can be promoted.");
  if (input.previouslyServed) return result("rollback", `v${input.version} was already promoted to "${input.tag}" before; going back to it does not need a new evaluation.`);
  if (input.policy.datasetId === null) return result("policy_incomplete", "The dataset of this prompt's promotion policy no longer exists. Choose another one to promote.");

  if (input.runs.length === 0) return result("no_evaluation", `No evaluation on the policy's dataset used v${input.version}. Run the evaluation with the agent reading this version.`);
  const complete = input.runs.filter((r) => r.status === "completed");
  if (complete.length === 0) return result("evaluation_running", `The evaluation of v${input.version} has not finished yet.`);

  const latest = [...complete].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, requiredRuns);
  const judged = latest.map((r) => judgeRun(r, input.targets ?? new Map<string, number>()));
  const failing = judged.find((j) => !j.passed);
  if (failing) return result("failed", describeFailure(failing), judged);
  if (judged.length < requiredRuns) {
    return result("insufficient_runs", `${requiredRuns} passing evaluations of v${input.version} are required and there ${judged.length === 1 ? "is" : "are"} ${judged.length}.`, judged);
  }
  return result("allowed", `The evaluation of v${input.version} passes${requiredRuns > 1 ? ` in its last ${requiredRuns} runs` : ""}.`, judged);
}
