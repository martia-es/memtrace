import type { RunNoiseComparisonResponse } from "@contract";

export type EvaluatorNoiseComparison = RunNoiseComparisonResponse["evaluators"][number];

/** Por qué no hay veredicto, en una frase para quien mira la pantalla (ADR-097). */
export const NOT_MEASURED_HINT: Record<NonNullable<EvaluatorNoiseComparison["reason"]>, string> = {
  no_repetitions: "Neither run was repeated, so the noise is unknown. Run it with repeats=3 to measure it.",
  dataset_changed: "The runs use a different dataset or version, so the noise of one does not apply to the other.",
  judge_changed: "The judge changed between the runs, so the noise measured with one does not apply to the other.",
  no_values: "One of the runs has no result for this evaluator.",
};

export function verdictLabel(c: EvaluatorNoiseComparison): string {
  return c.verdict === "above" ? "Above noise" : c.verdict === "within" ? "Within noise" : "Not measured";
}

/** `above` pinta la dirección del cambio; `within` y `not_measured` no pintan nada: no hay evidencia de que sea real. */
export function verdictTone(c: EvaluatorNoiseComparison): "ok" | "error" | "neutral" {
  if (c.verdict !== "above" || c.delta === null || c.delta === 0) return "neutral";
  return c.delta > 0 ? "ok" : "error";
}

/** «±2.0 pp» para un porcentaje, «±0.30» para una media; null si no hay margen. */
export function marginLabel(c: EvaluatorNoiseComparison): string | null {
  if (c.margin === null) return null;
  return c.dataType === "boolean" ? `±${(c.margin * 100).toFixed(1)} pp` : `±${c.margin.toFixed(2)}`;
}

/** Explicación de una frase de lo que significa el veredicto, para el tooltip. */
export function verdictExplanation(c: EvaluatorNoiseComparison): string {
  if (c.verdict === "not_measured") return NOT_MEASURED_HINT[c.reason ?? "no_repetitions"];
  const margin = marginLabel(c);
  return c.verdict === "above"
    ? `The change is larger than the noise measured by repeating the run (${margin}): it is not luck.`
    : `The change is within the noise measured by repeating the run (${margin}): repeating it could give the opposite sign.`;
}
