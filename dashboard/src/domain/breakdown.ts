import type { BreakdownItemDto, BreakdownResponse } from "@contract";
import { formatCostUsd, formatDuration, formatPercent } from "./format";

/** Con menos trazas que esto las cifras de una fila son ruido: se atenúa y no entra en los avisos. */
export const MIN_TRACES = 20;
/** Con menos valoraciones que esto, el 👍 es una anécdota. */
export const MIN_RATINGS = 20;

export type BreakdownItem = BreakdownItemDto;
export type BreakdownGroup = BreakdownResponse["groupBy"];
export type Tone = "ok" | "error" | "neutral";

export interface DeltaCell {
  label: string;
  from: string;
  to: string;
  delta: string;
  tone: Tone;
  note: string;
}

const MINUS = "−";
const signed = (n: number, text: string) => (n > 0 ? `+${text}` : n < 0 ? `${MINUS}${text}` : text);
const points = (ratio: number) => {
  const v = Math.abs(ratio * 100);
  return `${v.toFixed(v < 10 ? 1 : 0)} point${Math.abs(v - 1) < 0.05 ? "" : "s"}`;
};
const percentChange = (from: number, to: number) => Math.round((Math.abs(to - from) / from) * 100);

/**
 * Compara dos filas: a → b. Un entorno corre otra versión a propósito (así se ve la mejora antes de promoverla), y dos
 * versiones pueden compararse sin más; lo que importa es saber cuánto fiarse. Si los intervalos del 95 % de la tasa de error
 * se solapan, la diferencia puede ser ruido.
 */
export function compareBreakdown(a: BreakdownItem, b: BreakdownItem): DeltaCell[] {
  const few = a.traces < MIN_TRACES || b.traces < MIN_TRACES;

  const errDiff = b.errorRate - a.errorRate;
  const overlap = Math.abs(errDiff) <= a.errorMargin + b.errorMargin;
  const errors: DeltaCell = {
    label: "ERRORS",
    from: formatPercent(a.errorRate),
    to: formatPercent(b.errorRate),
    delta: errDiff === 0 ? "No change" : signed(errDiff, points(errDiff)),
    tone: overlap || few || errDiff === 0 ? "neutral" : errDiff < 0 ? "ok" : "error",
    note: few ? "Too few traces to trust" : overlap ? "Ranges overlap: may be noise" : "Ranges do not overlap: reliable",
  };

  let latency: DeltaCell;
  if (a.p95Ms === null || b.p95Ms === null) {
    latency = { label: "P95 LATENCY", from: "–", to: "–", delta: "–", tone: "neutral", note: "No latency recorded" };
  } else {
    const d = b.p95Ms - a.p95Ms;
    latency = {
      label: "P95 LATENCY",
      from: formatDuration(a.p95Ms),
      to: formatDuration(b.p95Ms),
      delta: d === 0 ? "No change" : signed(d, formatDuration(Math.abs(d))),
      tone: d === 0 ? "neutral" : d < 0 ? "ok" : "error",
      note: d === 0 || a.p95Ms === 0 ? "" : `${percentChange(a.p95Ms, b.p95Ms)} % ${d < 0 ? "faster" : "slower"}`,
    };
  }

  let cost: DeltaCell;
  if (a.costPerTraceUsd === null || b.costPerTraceUsd === null) {
    cost = { label: "COST PER TRACE", from: formatCostUsd(a.costPerTraceUsd) ?? "–", to: formatCostUsd(b.costPerTraceUsd) ?? "–", delta: "–", tone: "neutral", note: "No price for one of the models" };
  } else {
    const d = b.costPerTraceUsd - a.costPerTraceUsd;
    cost = {
      label: "COST PER TRACE",
      from: formatCostUsd(a.costPerTraceUsd)!,
      to: formatCostUsd(b.costPerTraceUsd)!,
      delta: d === 0 ? "No change" : signed(d, formatCostUsd(Math.abs(d))!),
      tone: d === 0 ? "neutral" : d < 0 ? "ok" : "error",
      note: d === 0 || a.costPerTraceUsd === 0 ? "" : `${percentChange(a.costPerTraceUsd, b.costPerTraceUsd)} % ${d < 0 ? "cheaper" : "more expensive"}`,
    };
  }

  let rating: DeltaCell;
  if (a.thumbsUpRate === null || b.thumbsUpRate === null) {
    rating = { label: "👍 RATE", from: a.thumbsUpRate === null ? "–" : formatPercent(a.thumbsUpRate), to: b.thumbsUpRate === null ? "–" : formatPercent(b.thumbsUpRate), delta: "–", tone: "neutral", note: "Nobody rated one of them" };
  } else {
    const d = b.thumbsUpRate - a.thumbsUpRate;
    const fewRatings = a.ratedTraces < MIN_RATINGS || b.ratedTraces < MIN_RATINGS;
    rating = {
      label: "👍 RATE",
      from: formatPercent(a.thumbsUpRate),
      to: formatPercent(b.thumbsUpRate),
      delta: d === 0 ? "No change" : signed(d, points(d)),
      tone: fewRatings || d === 0 ? "neutral" : d > 0 ? "ok" : "error",
      note: fewRatings ? "Few ratings: confirm with more traffic" : `Based on ${a.ratedTraces + b.ratedTraces} ratings`,
    };
  }
  return [errors, latency, cost, rating];
}

export interface BreakdownInsight {
  worst: BreakdownItem;
  best: BreakdownItem;
}

/** El peor y el mejor por tasa de error, solo si sus intervalos del 95 % no se solapan y ambos tienen trazas de sobra. */
export function findInsight(items: BreakdownItem[]): BreakdownInsight | null {
  const solid = items.filter((i) => i.traces >= MIN_TRACES);
  if (solid.length < 2) return null;
  const sorted = [...solid].sort((x, y) => y.errorRate - x.errorRate);
  const worst = sorted[0]!;
  const best = sorted[sorted.length - 1]!;
  return worst.errorRate - worst.errorMargin > best.errorRate + best.errorMargin ? { worst, best } : null;
}

/** Errores de cada día de la tendencia, 0..1; un día sin trazas es 0. */
export function trendRates(item: BreakdownItem): number[] {
  return item.trend.map((t) => (t.traces > 0 ? t.errorTraces / t.traces : 0));
}

/** Trazado de una sparkline en un rectángulo de `w`×`h`, con `max` como techo compartido para que las filas se comparen entre sí. */
export function sparkPath(values: number[], max: number, w: number, h: number, pad = 2): string {
  if (values.length < 2) return "";
  const top = max > 0 ? max : 1;
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(pad + (i / (values.length - 1)) * (w - 2 * pad)).toFixed(1)} ${(h - pad - (Math.min(v, top) / top) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
}

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV de la tabla, con las cifras sin formatear para poder explotarlas en una hoja de cálculo. */
export function breakdownCsv(groupBy: BreakdownGroup, items: BreakdownItem[]): string {
  const head = [groupBy === "environment" ? "environment" : "prompt_version", "traces", "error_traces", "error_rate", "error_margin_95", "p95_ms", "cost_usd", "cost_per_trace_usd", "cost_complete", "thumbs_up_rate", "rated_traces"];
  const rows = items.map((i) => [i.key, i.traces, i.errorTraces, i.errorRate, i.errorMargin, i.p95Ms, i.costUsd, i.costPerTraceUsd, i.costComplete, i.thumbsUpRate, i.ratedTraces]);
  return [head, ...rows].map((r) => r.map((c) => csvCell(c as string | number | null)).join(",")).join("\n");
}
