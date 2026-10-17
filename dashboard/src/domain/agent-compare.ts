import type { OverviewResponse } from "@contract";
import { formatCostUsd, formatCount, formatDuration, formatPercent } from "./format";
import { tr } from "./translate";

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
  { key: "cost", get label() { return tr("agent-compare.total_cost"); }, better: "lower", value: (o) => o.totals.costUsd, format: (v) => formatCostUsd(v) ?? "–" },
  { key: "tokens", get label() { return tr("agent-compare.total_tokens"); }, better: "lower", value: (o) => o.totals.totalTokens, format: formatCount },
  { key: "p50", get label() { return tr("agent-compare.latency_p50"); }, better: "lower", value: (o) => o.latencyMs.p50, format: formatDuration },
  { key: "p95", get label() { return tr("agent-compare.latency_p95"); }, better: "lower", value: (o) => o.latencyMs.p95, format: formatDuration },
  { key: "p99", get label() { return tr("agent-compare.latency_p99"); }, better: "lower", value: (o) => o.latencyMs.p99, format: formatDuration },
  { key: "errors", get label() { return tr("agent-compare.error_rate"); }, better: "lower", value: (o) => o.totals.errorRate, format: formatPercent },
  { key: "conversations", get label() { return tr("agent-compare.conversations"); }, better: "none", value: (o) => o.totals.conversations, format: formatCount },
  { key: "executions", get label() { return tr("agent-compare.executions"); }, better: "none", value: (o) => o.totals.traces, format: formatCount },
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
  cost: { get better() { return tr("agent-compare.cheaper"); }, get worse() { return tr("agent-compare.more_expensive"); } },
  tokens: { get better() { return tr("agent-compare.lighter_on_tokens"); }, get worse() { return tr("agent-compare.heavier_on_tokens"); } },
  p50: { get better() { return tr("agent-compare.faster"); }, get worse() { return tr("agent-compare.slower"); } },
  p99: { get better() { return tr("agent-compare.steadier_in_the_slowest_answers"); }, get worse() { return tr("agent-compare.slower_in_the_slowest_answers"); } },
  errors: { get better() { return tr("agent-compare.more_reliable"); }, get worse() { return tr("agent-compare.failing_more_often"); } },
};

function joinPhrases(items: string[]): string {
  return items.length > 1 ? tr("agent-compare.list_and_last", { list: items.slice(0, -1).join(", "), last: items[items.length - 1]! }) : (items[0] ?? "");
}

export function compareVerdict(rows: CompareRow[], nameA = tr("agent-compare.the_first_experiment"), nameB = tr("agent-compare.the_second_experiment")): CompareVerdict {
  const better = rows.filter((r) => r.tone === "better");
  const worse = rows.filter((r) => r.tone === "worse");
  const neutral = rows.length - better.length - worse.length;
  const phrases = (list: CompareRow[], side: "better" | "worse") => list.map((r) => PHRASES[r.key]?.[side]).filter((p): p is string => !!p);
  const good = phrases(better, "better");
  const bad = phrases(worse, "worse");

  let headline = tr("agent-compare.no_meaningful_difference_between_b_and", { a: nameA, b: nameB });
  if (good.length && bad.length) headline = tr("agent-compare.b_is_good_but_bad", { b: nameB, good: joinPhrases(good), bad: joinPhrases(bad) });
  else if (good.length) headline = tr("agent-compare.b_is_phrases", { b: nameB, phrases: joinPhrases(good) });
  else if (bad.length) headline = tr("agent-compare.b_is_phrases", { b: nameB, phrases: joinPhrases(bad) });
  if (good.length || bad.length) headline += ` ${tr("agent-compare.than_a", { a: nameA })}`;

  const changed = [...better, ...worse].map((r) => `${r.label} ${r.a} → ${r.b} (${r.deltaText.replace(/^[▼▲] /, (m) => (m.startsWith("▼") ? "−" : "+"))})`);
  const detail = changed.length ? changed.join(" · ") : tr("agent-compare.every_metric_moved_less_than_percent", { percent: NEUTRAL_THRESHOLD * 100 });
  const tone = better.length && worse.length ? "mixed" : better.length ? "good" : worse.length ? "bad" : "flat";
  return { better: better.length, worse: worse.length, neutral, headline, detail, tone };
}
