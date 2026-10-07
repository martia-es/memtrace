import type { OverviewResponse } from "@contract";
import { formatCostUsd, formatCount, formatDuration, formatPercent } from "./format";

/** Un cambio de menos de este porcentaje relativo es ruido: no se pinta ni de mejor ni de peor. */
export const NEUTRAL_THRESHOLD = 0.05;

export type CompareTone = "better" | "worse" | "neutral";

export interface CompareRow {
  key: string;
  label: string;
  a: string;
  b: string;
  /** Cambio relativo de B respecto a A (-0.64 = 64 % menos); null si A vale 0 y B no, sin base para comparar. */
  change: number | null;
  tone: CompareTone;
  /** "▼ 64%", "▲ 19%", "≈ 0%" o "–" */
  deltaText: string;
}

interface MetricDef {
  key: string;
  label: string;
  /** "lower": menos es mejor; "none": volumen, ni mejor ni peor. */
  better: "lower" | "none";
  value: (o: OverviewResponse) => number;
  format: (v: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "cost", label: "Total cost", better: "lower", value: (o) => o.totals.costUsd, format: (v) => formatCostUsd(v) ?? "–" },
  { key: "tokens", label: "Total tokens", better: "lower", value: (o) => o.totals.totalTokens, format: formatCount },
  { key: "p50", label: "Latency p50", better: "lower", value: (o) => o.latencyMs.p50, format: formatDuration },
  { key: "p95", label: "Latency p95", better: "lower", value: (o) => o.latencyMs.p95, format: formatDuration },
  { key: "p99", label: "Latency p99", better: "lower", value: (o) => o.latencyMs.p99, format: formatDuration },
  { key: "errors", label: "Error rate", better: "lower", value: (o) => o.totals.errorRate, format: formatPercent },
  { key: "conversations", label: "Conversations", better: "none", value: (o) => o.totals.conversations, format: formatCount },
  { key: "executions", label: "Executions", better: "none", value: (o) => o.totals.traces, format: formatCount },
];

export function relativeChange(a: number, b: number): number | null {
  if (a === 0) return b === 0 ? 0 : null;
  return (b - a) / a;
}

function toneOf(change: number | null, better: MetricDef["better"]): CompareTone {
  if (change === null || better === "none" || Math.abs(change) < NEUTRAL_THRESHOLD) return "neutral";
  return change < 0 ? "better" : "worse";
}

export function formatChange(change: number | null): string {
  if (change === null) return "–";
  const pct = Math.round(Math.abs(change) * 100);
  if (pct < 1) return "≈ 0%";
  return `${change < 0 ? "▼" : "▲"} ${pct}%`;
}

export function compareRows(a: OverviewResponse, b: OverviewResponse): CompareRow[] {
  return METRICS.map((m) => {
    const va = m.value(a);
    const vb = m.value(b);
    const change = relativeChange(va, vb);
    return { key: m.key, label: m.label, a: m.format(va), b: m.format(vb), change, tone: toneOf(change, m.better), deltaText: formatChange(change) };
  });
}

/** Coste medio de una ejecución; null si no hay ejecuciones o ningún modelo usado tiene precio (ADR-025). */
export function costPerExecution(o: OverviewResponse): number | null {
  return o.totals.traces > 0 && o.totals.costUsd > 0 ? o.totals.costUsd / o.totals.traces : null;
}

export function formatCostPerExecution(v: number | null): string {
  return v === null ? "–" : `$${v.toFixed(v < 0.01 ? 4 : 3)}`;
}

export interface CompareVerdict {
  better: number;
  worse: number;
  neutral: number;
  headline: string;
  detail: string;
  /** Tono del banner: todo bien, mezcla, o todo peor. */
  tone: "good" | "mixed" | "bad" | "flat";
}

const PHRASES: Record<string, { better: string; worse: string }> = {
  cost: { better: "cheaper", worse: "more expensive" },
  tokens: { better: "lighter on tokens", worse: "heavier on tokens" },
  p50: { better: "faster", worse: "slower" },
  p99: { better: "steadier in the slowest answers", worse: "slower in the slowest answers" },
  errors: { better: "more reliable", worse: "failing more often" },
};

function joinPhrases(items: string[]): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : (items[0] ?? "");
}

export function compareVerdict(rows: CompareRow[]): CompareVerdict {
  const better = rows.filter((r) => r.tone === "better");
  const worse = rows.filter((r) => r.tone === "worse");
  const neutral = rows.length - better.length - worse.length;
  const phrases = (list: CompareRow[], side: "better" | "worse") => list.map((r) => PHRASES[r.key]?.[side]).filter((p): p is string => !!p);
  const good = phrases(better, "better");
  const bad = phrases(worse, "worse");

  let headline = "No meaningful difference between A and B";
  if (good.length && bad.length) headline = `B is ${joinPhrases(good)}, but ${joinPhrases(bad)}`;
  else if (good.length) headline = `B is ${joinPhrases(good)}`;
  else if (bad.length) headline = `B is ${joinPhrases(bad)}`;
  headline = headline[0]!.toUpperCase() + headline.slice(1);

  const changed = [...better, ...worse].map((r) => `${r.label} ${r.a} → ${r.b} (${r.deltaText.replace(/^[▼▲] /, (m) => (m.startsWith("▼") ? "−" : "+"))})`);
  const detail = changed.length ? changed.join(" · ") : `Every metric moved less than ${NEUTRAL_THRESHOLD * 100}%.`;
  const tone = better.length && worse.length ? "mixed" : better.length ? "good" : worse.length ? "bad" : "flat";
  return { better: better.length, worse: worse.length, neutral, headline, detail, tone };
}
