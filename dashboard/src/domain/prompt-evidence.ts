import type { VersionEvidenceDto } from "@contract";
import { formatCostUsd, formatDuration, formatPercent } from "./format";

/**
 * Comparar dos versiones de un prompt con su evidencia (ADR-069). Con pocas trazas una diferencia es ruido, así que
 * cada comparación dice si la muestra aguanta; y cada métrica sabe si más es mejor o peor.
 */

/** Por debajo de esto, las cifras de una versión son indicativas, no una conclusión. */
export const MIN_TRACES = 30;

export type SampleQuality = "none" | "low" | "ok";

export function sampleQuality(traces: number): SampleQuality {
  return traces === 0 ? "none" : traces < MIN_TRACES ? "low" : "ok";
}

export type Direction = "better" | "worse" | "same" | "unknown";

export interface MetricDelta {
  key: string;
  label: string;
  base: string;
  target: string;
  /** diferencia ya formateada, con signo (`+2.1 pp`, `−120 ms`) */
  change: string;
  direction: Direction;
}

export interface VersionComparison {
  deltas: MetricDelta[];
  /** false si alguna de las dos versiones tiene pocas trazas: las diferencias pueden ser azar */
  reliable: boolean;
}

/** Cambio relativo por debajo del cual se considera que la métrica no se ha movido. */
const SAME_BELOW = 0.05;

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

function direction(base: number | null, target: number | null, higherIsBetter: boolean, absoluteFloor = 0): Direction {
  if (base === null || target === null) return "unknown";
  const diff = target - base;
  if (Math.abs(diff) <= absoluteFloor) return "same";
  const scale = Math.max(Math.abs(base), Math.abs(target));
  if (scale > 0 && Math.abs(diff) / scale < SAME_BELOW) return "same";
  return diff > 0 === higherIsBetter ? "better" : "worse";
}

const percent = (ratio: number | null) => (ratio === null ? "–" : formatPercent(ratio));
const points = (diffRatio: number) => `${sign(diffRatio)}${Math.abs(diffRatio * 100).toFixed(1)} pp`;

export function compareVersions(base: VersionEvidenceDto, target: VersionEvidenceDto): VersionComparison {
  const deltas: MetricDelta[] = [];

  deltas.push({
    key: "errorRate",
    label: "Error rate",
    base: percent(base.errorRate),
    target: percent(target.errorRate),
    change: points(target.errorRate - base.errorRate),
    direction: direction(base.errorRate, target.errorRate, false, 0.005),
  });

  deltas.push({
    key: "p95",
    label: "Latency p95",
    base: formatDuration(base.latencyMs.p95),
    target: formatDuration(target.latencyMs.p95),
    change: `${sign(target.latencyMs.p95 - base.latencyMs.p95)}${formatDuration(Math.abs(target.latencyMs.p95 - base.latencyMs.p95))}`,
    direction: direction(base.latencyMs.p95, target.latencyMs.p95, false),
  });

  const cost = base.costPerTraceUsd !== null && target.costPerTraceUsd !== null;
  deltas.push({
    key: "cost",
    label: "Cost per trace",
    base: formatCostUsd(base.costPerTraceUsd) ?? "–",
    target: formatCostUsd(target.costPerTraceUsd) ?? "–",
    change: cost ? `${sign(target.costPerTraceUsd! - base.costPerTraceUsd!)}${formatCostUsd(Math.abs(target.costPerTraceUsd! - base.costPerTraceUsd!))}` : "–",
    direction: direction(base.costPerTraceUsd, target.costPerTraceUsd, false),
  });

  const sat = base.feedback.satisfaction !== null && target.feedback.satisfaction !== null;
  deltas.push({
    key: "satisfaction",
    label: "User 👍",
    base: base.feedback.satisfaction === null ? "–" : `${base.feedback.satisfaction.toFixed(0)}%`,
    target: target.feedback.satisfaction === null ? "–" : `${target.feedback.satisfaction.toFixed(0)}%`,
    change: sat ? `${sign(target.feedback.satisfaction! - base.feedback.satisfaction!)}${Math.abs(target.feedback.satisfaction! - base.feedback.satisfaction!).toFixed(0)} pp` : "–",
    direction: direction(base.feedback.satisfaction, target.feedback.satisfaction, true, 1),
  });

  // evaluadores que existen en las dos versiones: comparar manzanas con manzanas
  for (const e of base.evaluators) {
    const other = target.evaluators.find((x) => x.name === e.name && x.dataType === e.dataType);
    if (!other || e.dataType === "categorical") continue;
    const boolean = e.dataType === "boolean";
    deltas.push({
      key: `eval:${e.name}`,
      label: `${e.name}${boolean ? " pass rate" : " (avg)"}`,
      base: boolean ? percent(e.value) : (e.value?.toFixed(2) ?? "–"),
      target: boolean ? percent(other.value) : (other.value?.toFixed(2) ?? "–"),
      change: e.value === null || other.value === null ? "–" : boolean ? points(other.value - e.value) : `${sign(other.value - e.value)}${Math.abs(other.value - e.value).toFixed(2)}`,
      direction: direction(e.value, other.value, true, boolean ? 0.005 : 0),
    });
  }

  return { deltas, reliable: sampleQuality(base.traces) === "ok" && sampleQuality(target.traces) === "ok" };
}

/** Nombres de evaluador que aparecen en alguna versión, para las columnas de la tabla. */
export function evaluatorNames(versions: VersionEvidenceDto[]): string[] {
  return [...new Set(versions.flatMap((v) => v.evaluators.map((e) => e.name)))].sort();
}

export function evaluatorCell(version: VersionEvidenceDto, name: string): string {
  const e = version.evaluators.find((x) => x.name === name);
  if (!e) return "–";
  if (e.dataType === "boolean") return e.value === null ? "–" : formatPercent(e.value);
  if (e.dataType === "numeric") return e.value === null ? "–" : e.value.toFixed(2);
  return `${e.items} items`;
}
