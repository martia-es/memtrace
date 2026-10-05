import type { RunListItemDto } from "@contract";
import type { EChartsCoreOption } from "echarts/core";
import { aggregateTone, judgeChanged, judgeSignature, type AggregateTone } from "@/domain/evaluation";
import { chartColors } from "./chart-theme";

export type OfflineMetricKind = "passRate" | "average";

export interface OfflineSeries {
  name: string;
  /** Un valor por run (mismo orden que `runs`); `null` si el run no tiene ese evaluador. */
  values: (number | null)[];
  /** Mismo orden que `values`: `true` si el juez de este punto no es el del run anterior que tenía este evaluador
   * (ADR-043), así que la subida/bajada respecto a ese punto no es una mejora/regresión del agente. */
  judgeChanged: boolean[];
}

export interface JudgeChangeNotice {
  evaluator: string;
  fromRun: string;
  toRun: string;
  from: string;
  to: string;
}

/** Runs completados, más antiguos primero, dentro del rango y (opcional) de un dataset. Los `running`
 * se excluyen: sus agregados son parciales y pintarían una caída falsa (ADR-034). */
export function selectOfflineRuns(runs: RunListItemDto[], range: { from: string; to: string }, datasetId: string | null): RunListItemDto[] {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  return runs
    .filter((r) => r.status === "completed")
    .filter((r) => !datasetId || r.datasetId === datasetId)
    .filter((r) => {
      const t = Date.parse(r.createdAt);
      return t >= from && t <= to;
    })
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Una serie por evaluador. `passRate` (booleanos, 0-1) y `average` (numéricos) tienen escalas distintas,
 * por eso se grafican por separado. Los categóricos no tienen agregación todavía. */
export function buildOfflineSeries(runs: RunListItemDto[], kind: OfflineMetricKind): OfflineSeries[] {
  const names = new Set<string>();
  for (const r of runs) for (const a of r.aggregates) if ((kind === "passRate" ? a.passRate : a.average) !== null) names.add(a.name);
  return [...names].sort().map((name) => {
    let lastWithEvaluator: RunListItemDto["aggregates"][number] | undefined;
    const values: (number | null)[] = [];
    const changed: boolean[] = [];
    for (const r of runs) {
      const agg = r.aggregates.find((a) => a.name === name);
      values.push((agg ? (kind === "passRate" ? agg.passRate : agg.average) : null) ?? null);
      changed.push(judgeChanged(lastWithEvaluator, agg));
      if (agg) lastWithEvaluator = agg;
    }
    return { name, values, judgeChanged: changed };
  });
}

/** Un aviso por cada vez que el juez de un evaluador cambia entre dos runs consecutivos (ADR-043). */
export function judgeChangeNotices(runs: RunListItemDto[]): JudgeChangeNotice[] {
  const notices: JudgeChangeNotice[] = [];
  const names = new Set(runs.flatMap((r) => r.aggregates.map((a) => a.name)));
  for (const name of [...names].sort()) {
    let prev: { run: RunListItemDto; agg: RunListItemDto["aggregates"][number] } | undefined;
    for (const run of runs) {
      const agg = run.aggregates.find((a) => a.name === name);
      if (!agg) continue;
      if (prev && judgeChanged(prev.agg, agg)) {
        notices.push({ evaluator: name, fromRun: offlineRunLabel(prev.run), toRun: offlineRunLabel(run), from: judgeSignature(prev.agg)!, to: judgeSignature(agg)! });
      }
      prev = { run, agg };
    }
  }
  return notices;
}

export function offlineRunLabel(r: RunListItemDto): string {
  return `${r.name} · v${r.versionMajor}.${r.versionMinor}`;
}

export function offlineEvalChartOption(runs: RunListItemDto[], series: OfflineSeries[], kind: OfflineMetricKind, isDark: boolean): EChartsCoreOption {
  const c = chartColors(isDark);
  const isRate = kind === "passRate";
  const fmt = (v: number) => (isRate ? `${(v * 100).toFixed(1)} %` : v.toFixed(2));
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    grid: { left: 6, right: 12, top: 32, bottom: 6, containLabel: true },
    legend: { top: 0, textStyle: { color: c.text, fontSize: 11 } },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: unknown) => (typeof v === "number" ? fmt(v) : "–"),
    },
    xAxis: {
      type: "category",
      data: runs.map(offlineRunLabel),
      axisLabel: { color: c.muted, fontSize: 11, hideOverlap: true },
      axisLine: { lineStyle: { color: c.grid } },
    },
    yAxis: {
      type: "value",
      ...(isRate ? { min: 0, max: 1 } : {}),
      axisLabel: { color: c.muted, fontSize: 11, formatter: (v: number) => (isRate ? `${Math.round(v * 100)} %` : String(v)) },
      splitLine: { lineStyle: { color: c.grid, type: "dashed" } },
    },
    series: series.map((s, i) => ({
      name: s.name,
      type: "line",
      connectNulls: false,
      symbolSize: 7,
      lineStyle: { width: 2.5, color: c.series[i % c.series.length] },
      itemStyle: { color: c.series[i % c.series.length] },
      ...(isRate && i === 0
        ? { markLine: { silent: true, symbol: "none", label: { color: c.muted, fontSize: 10, formatter: "{c}" }, lineStyle: { color: c.ok, type: "dashed", opacity: 0.6 }, data: [{ yAxis: 0.8, label: { formatter: "80% target" } }] } }
        : {}),
      // un rombo en el color de peligro marca dónde cambió el juez (ADR-043)
      data: s.values.map((value, idx) => (s.judgeChanged[idx] && value !== null ? { value, symbol: "diamond", symbolSize: 13, itemStyle: { color: c.danger } } : value)),
    })),
  };
}

export type EvaluatorStatus = "improving" | "regressing" | "stable" | "judge-changed" | "first-run";

export interface EvaluatorSummary {
  name: string;
  kind: OfflineMetricKind;
  latest: number | null;
  /** Valor del run anterior que tenía este evaluador; `null` si es el primero. */
  previous: number | null;
  delta: number | null;
  status: EvaluatorStatus;
  /** Mismo umbral que las tarjetas KPI (≥80% ok, <50% mal). Los promedios no tienen escala conocida: `default`. */
  tone: AggregateTone;
  /** Scores del último run (items evaluados). */
  count: number;
  /** Solo `passRate`: items que pasaron / fallaron en el último run. */
  passed: number | null;
  failed: number | null;
  /** Valor en cada run que tenía este evaluador, más antiguo primero (para el sparkline). */
  history: number[];
}

/** Diferencias menores que esto se consideran ruido, no movimiento. */
const STABLE_EPSILON = 0.005;

/** Resumen por evaluador: el último valor frente al anterior. Pensado para la tabla de cabecera, no para gráficas. */
export function summarizeEvaluators(runs: RunListItemDto[]): EvaluatorSummary[] {
  const names = new Set<string>();
  for (const r of runs) for (const a of r.aggregates) names.add(a.name);
  const out: EvaluatorSummary[] = [];
  for (const name of [...names].sort()) {
    const withEvaluator = runs.flatMap((r) => r.aggregates.filter((a) => a.name === name));
    const kind: OfflineMetricKind = withEvaluator.some((a) => a.passRate !== null) ? "passRate" : "average";
    const value = (a: RunListItemDto["aggregates"][number] | undefined) => (a ? (kind === "passRate" ? a.passRate : a.average) : null);
    const valued = withEvaluator.filter((a) => value(a) !== null);
    const latestAgg = valued[valued.length - 1];
    const prevAgg = valued[valued.length - 2];
    if (!latestAgg) continue;
    const latest = value(latestAgg);
    const previous = prevAgg ? value(prevAgg) : null;
    const delta = latest !== null && previous !== null ? latest - previous : null;
    let status: EvaluatorStatus;
    if (!prevAgg) status = "first-run";
    else if (judgeChanged(prevAgg, latestAgg)) status = "judge-changed";
    else if (delta === null || Math.abs(delta) < STABLE_EPSILON) status = "stable";
    else status = delta > 0 ? "improving" : "regressing";
    const passed = kind === "passRate" && latestAgg.passRate !== null ? Math.round(latestAgg.passRate * latestAgg.count) : null;
    out.push({
      name,
      kind,
      latest,
      previous,
      delta,
      status,
      tone: aggregateTone(latestAgg),
      count: latestAgg.count,
      passed,
      failed: passed === null ? null : latestAgg.count - passed,
      history: valued.map((a) => value(a)!),
    });
  }
  return out;
}

export type VerdictLevel = "healthy" | "attention" | "failing" | "unknown";

export interface OfflineVerdict {
  level: VerdictLevel;
  title: string;
  detail: string;
}

/** Respuesta a "¿cómo va el sistema?": el peor de los evaluadores booleanos del último run manda. */
export function offlineVerdict(summary: EvaluatorSummary[]): OfflineVerdict {
  const rated = summary.filter((s) => s.kind === "passRate");
  if (!rated.length) return { level: "unknown", title: "No pass/fail evaluators yet", detail: "Add a boolean evaluator (e.g. exact_match) to get a health verdict." };
  const failing = rated.filter((s) => s.tone === "negative");
  const regressing = rated.filter((s) => s.status === "regressing");
  const weak = rated.filter((s) => s.tone === "warning");
  const names = (list: EvaluatorSummary[]) => list.map((s) => s.name).join(", ");
  if (failing.length) return { level: "failing", title: "Failing", detail: `Below 50% pass rate: ${names(failing)}.` };
  if (regressing.length) return { level: "attention", title: "Regressing", detail: `Lower than the previous run: ${names(regressing)}.` };
  if (weak.length) return { level: "attention", title: "Needs attention", detail: `Between 50% and 80%: ${names(weak)}.` };
  return { level: "healthy", title: "Healthy", detail: "Every pass/fail evaluator is at 80% or above." };
}

/** Barras apiladas aprobados/fallados del último run por evaluador booleano: funciona con un solo run. */
export function passFailChartOption(summary: EvaluatorSummary[], isDark: boolean): EChartsCoreOption {
  const c = chartColors(isDark);
  const rated = summary.filter((s) => s.kind === "passRate");
  const bar = (name: string, color: string, pick: (s: EvaluatorSummary) => number) => ({
    name,
    type: "bar",
    stack: "items",
    barMaxWidth: 28,
    itemStyle: { color },
    label: { show: true, color: "#fff", fontSize: 11, fontWeight: 600, formatter: (p: { value: number }) => (p.value > 0 ? String(p.value) : "") },
    data: rated.map(pick),
  });
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    grid: { left: 6, right: 16, top: 32, bottom: 6, containLabel: true },
    legend: { top: 0, textStyle: { color: c.text, fontSize: 11 } },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted, fontSize: 11 }, splitLine: { lineStyle: { color: c.grid, type: "dashed" } } },
    yAxis: { type: "category", inverse: true, data: rated.map((s) => s.name), axisLabel: { color: c.text, fontSize: 12 }, axisLine: { lineStyle: { color: c.grid } } },
    series: [bar("Passed", c.ok, (s) => s.passed ?? 0), bar("Failed", c.danger, (s) => s.failed ?? 0)],
  };
}
