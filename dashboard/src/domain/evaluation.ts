import type { ScoreAggregateDto } from "@contract";
import { formatPercent } from "./format";

/** Umbral compartido por las tarjetas KPI y las pills: ≥80% ok, <50% mal, si no aviso. */
export type AggregateTone = "positive" | "warning" | "negative" | "default";

export function aggregateTone(a: ScoreAggregateDto): AggregateTone {
  if (a.passRate === null) return "default";
  if (a.passRate >= 0.8) return "positive";
  if (a.passRate < 0.5) return "negative";
  return "warning";
}

/** `"66 %"` para un booleano, la media formateada para un numérico, o `"–"` si no hay agregación. */
export function aggregateValueLabel(a: ScoreAggregateDto): string {
  if (a.passRate !== null) return formatPercent(a.passRate);
  if (a.average !== null) return a.average.toFixed(2);
  return "–";
}
