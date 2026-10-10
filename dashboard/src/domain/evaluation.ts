import type { ScoreAggregateDto } from "@contract";
import { formatPercent } from "./format";

/** Objetivo de pass rate cuando el evaluador no tiene score config con `targetPassRate` propio (ADR-060). */
export const DEFAULT_TARGET_PASS_RATE = 0.8;

/** Umbral compartido por las tarjetas KPI y las pills: ≥objetivo ok, <50% (o el objetivo, si es menor) mal, si no aviso. */
export type AggregateTone = "positive" | "warning" | "negative" | "default";

/** Tono de `Pill` para un agregado (la UI no conoce las claves del dominio). */
export function aggregatePillTone(t: AggregateTone): "ok" | "warn" | "error" | "neutral" {
  return t === "positive" ? "ok" : t === "warning" ? "warn" : t === "negative" ? "error" : "neutral";
}

export function aggregateTone(a: ScoreAggregateDto, target: number = DEFAULT_TARGET_PASS_RATE): AggregateTone {
  if (a.passRate === null) return "default";
  if (a.passRate >= target) return "positive";
  if (a.passRate < Math.min(0.5, target)) return "negative";
  return "warning";
}

/** `"66 %"` para un booleano, la media formateada para un numérico, o `"–"` si no hay agregación. */
export function aggregateValueLabel(a: ScoreAggregateDto): string {
  if (a.passRate !== null) return formatPercent(a.passRate);
  if (a.average !== null) return a.average.toFixed(2);
  return "–";
}

/** Huella legible del juez que produjo un agregado (ADR-043), o `null` si no es `llm_judge`.
 * Varias identidades (un run que mezcla jueces, o scores anteriores a ADR-043) se unen con " + ". */
export function judgeSignature(a: ScoreAggregateDto): string | null {
  if (!a.judges?.length) return null;
  return [...new Set(a.judges.map((j) => `${j.model ?? "unknown model"} · rubric ${j.promptHash ?? "n/a"}`))].sort().join(" + ");
}

/** `true` si ambos agregados vienen de un juez y no es el mismo: sus porcentajes no son comparables directamente. */
export function judgeChanged(before: ScoreAggregateDto | undefined, after: ScoreAggregateDto | undefined): boolean {
  if (!before || !after) return false;
  const a = judgeSignature(before);
  const b = judgeSignature(after);
  return a !== null && b !== null && a !== b;
}
