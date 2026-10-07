import { ValidationError } from "./errors";

/**
 * Gate de despliegue (ADR-064): un commit solo se despliega si existe una evaluación offline exitosa de ese mismo
 * commit. Reglas puras: sin base de datos, sin HTTP. El servicio reúne los datos y esta función decide.
 */

/** Objetivo de pass rate de un evaluador sin score config propia (ADR-060). */
export const DEFAULT_TARGET_PASS_RATE = 0.8;

/** Cuántos runs seguidos del commit deben pasar. Por entorno, más adelante (p. ej. PRO exigiendo más de uno). */
export const DEFAULT_REQUIRED_RUNS = 1;

export type GateVerdict =
  /** hay evaluación exitosa del commit */
  | "allowed"
  /** el commit ya se desplegó con éxito antes: volver a él no exige evaluar de nuevo */
  | "rollback"
  /** ningún run evaluó este commit */
  | "no_evaluation"
  /** los runs de este commit siguen subiendo resultados */
  | "evaluation_running"
  /** solo hay runs hechos con cambios sin commitear: no representan el código del commit */
  | "only_dirty_runs"
  /** el run más reciente del commit no alcanza el objetivo de algún evaluador */
  | "failed"
  /** pasan, pero hacen falta más runs de los que hay */
  | "insufficient_runs";

export interface GateAggregate {
  name: string;
  dataType: string;
  passRate: number | null;
}

export interface GateRun {
  id: string;
  name: string;
  status: "running" | "completed";
  revision: string | null;
  revisionDirty: boolean | null;
  createdAt: string;
  aggregates: GateAggregate[];
}

export interface GateFailure {
  evaluator: string;
  passRate: number | null;
  target: number;
}

export interface GateRunResult {
  runId: string;
  name: string;
  passed: boolean;
  failures: GateFailure[];
}

export interface GateResult {
  allowed: boolean;
  verdict: GateVerdict;
  sha: string;
  requiredRuns: number;
  /** runs completos y limpios del commit que se miraron, el más reciente primero */
  runs: GateRunResult[];
  reason: string;
}

const SHA = /^[0-9a-f]{7,64}$/;

export function validateSha(sha: string): string {
  const value = sha.trim().toLowerCase();
  if (!SHA.test(value)) throw new ValidationError("Invalid commit", { sha: "Must be a hexadecimal commit SHA (7 to 64 characters)" });
  return value;
}

/** ¿El run evaluó este commit? Igual si uno es prefijo del otro (el SHA corto del dashboard vale). */
export function sameRevision(runRevision: string | null, sha: string): boolean {
  if (!runRevision) return false;
  const a = runRevision.toLowerCase();
  return a === sha || (a.length >= 7 && sha.length >= 7 && (a.startsWith(sha) || sha.startsWith(a)));
}

/**
 * Un run pasa si tiene al menos un evaluador booleano y todos alcanzan su objetivo. Los evaluadores numéricos o
 * categóricos no tienen un pass rate que comparar, así que no deciden. Un evaluador sin resultados (`passRate` null) falla.
 */
export function judgeRun(run: GateRun, targets: ReadonlyMap<string, number>): GateRunResult {
  const booleans = run.aggregates.filter((a) => a.dataType === "boolean");
  const failures: GateFailure[] = booleans
    .map((a) => ({ evaluator: a.name, passRate: a.passRate, target: targets.get(a.name) ?? DEFAULT_TARGET_PASS_RATE }))
    .filter((f) => f.passRate === null || f.passRate < f.target);
  return { runId: run.id, name: run.name, passed: booleans.length > 0 && failures.length === 0, failures };
}

export function evaluateDeployGate(input: {
  sha: string;
  runs: GateRun[];
  targets?: ReadonlyMap<string, number>;
  requiredRuns?: number;
  /** el commit ya se desplegó con éxito en algún momento (rollback) */
  previouslyDeployed?: boolean;
}): GateResult {
  const sha = validateSha(input.sha);
  const requiredRuns = Math.max(1, input.requiredRuns ?? DEFAULT_REQUIRED_RUNS);
  const targets = input.targets ?? new Map<string, number>();
  const result = (verdict: GateVerdict, reason: string, runs: GateRunResult[] = []): GateResult => ({
    allowed: verdict === "allowed" || verdict === "rollback",
    verdict,
    sha,
    requiredRuns,
    runs,
    reason,
  });

  if (input.previouslyDeployed) return result("rollback", "This commit was already deployed successfully; going back to it does not need a new evaluation.");

  const mine = input.runs.filter((r) => sameRevision(r.revision, sha));
  if (mine.length === 0) return result("no_evaluation", "No offline evaluation was run on this commit. Run the evaluation from the CI on this commit first.");

  const clean = mine.filter((r) => r.status === "completed" && r.revisionDirty !== true);
  if (clean.length === 0) {
    if (mine.some((r) => r.status === "running")) return result("evaluation_running", "The evaluation of this commit has not finished yet.");
    return result("only_dirty_runs", "The only evaluations of this commit were run with uncommitted changes, so they do not represent its code. Run it from the CI.");
  }

  const latest = [...clean].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, requiredRuns);
  const judged = latest.map((r) => judgeRun(r, targets));
  const failing = judged.find((j) => !j.passed);
  if (failing) {
    const why = failing.failures.length
      ? failing.failures.map((f) => `${f.evaluator} ${f.passRate === null ? "has no results" : `${Math.round(f.passRate * 100)}%`} (target ${Math.round(f.target * 100)}%)`).join(", ")
      : "it has no boolean evaluator to judge";
    return result("failed", `The evaluation "${failing.name}" does not pass: ${why}.`, judged);
  }
  if (judged.length < requiredRuns) {
    return result("insufficient_runs", `${requiredRuns} passing evaluations of this commit are required and there ${judged.length === 1 ? "is" : "are"} ${judged.length}.`, judged);
  }
  return result("allowed", `The evaluation of this commit passes${requiredRuns > 1 ? ` in its last ${requiredRuns} runs` : ""}.`, judged);
}
