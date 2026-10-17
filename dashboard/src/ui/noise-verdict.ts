import type { RunNoiseComparisonResponse } from "@contract";
import { t } from "./i18n";
import { lazyMessages } from "../domain/translate";

export type EvaluatorNoiseComparison = RunNoiseComparisonResponse["evaluators"][number];

/** Por qué no hay veredicto, en una frase para quien mira la pantalla (ADR-097). */
export const NOT_MEASURED_HINT: Record<NonNullable<EvaluatorNoiseComparison["reason"]>, string> = lazyMessages({
  no_repetitions: "noise-verdict.neither_run_was_repeated_so_the",
  dataset_changed: "noise-verdict.the_runs_use_a_different_dataset",
  judge_changed: "noise-verdict.the_judge_changed_between_the_runs",
  no_values: "noise-verdict.one_of_the_runs_has_no",
});

export function verdictLabel(c: EvaluatorNoiseComparison): string {
  return c.verdict === "above" ? t("noise-verdict.above_noise") : c.verdict === "within" ? t("noise-verdict.within_noise") : t("noise-verdict.not_measured");
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
    ? t("noise-verdict.the_change_is_larger_than_the", { margin })
    : t("noise-verdict.the_change_is_within_the_noise", { margin });
}
