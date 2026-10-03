import type { RunListItemDto } from "@contract";
import type { EChartsCoreOption } from "echarts/core";
import { judgeChanged, judgeSignature } from "@/domain/evaluation";
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
      // un rombo en el color de peligro marca dónde cambió el juez (ADR-043)
      data: s.values.map((value, idx) => (s.judgeChanged[idx] && value !== null ? { value, symbol: "diamond", symbolSize: 13, itemStyle: { color: c.danger } } : value)),
    })),
  };
}
