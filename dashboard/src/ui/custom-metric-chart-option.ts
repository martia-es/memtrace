import type { CustomMetricDefinitionDto, CustomMetricPointDto } from "@contract";
import type { EChartsCoreOption } from "echarts/core";
import { chartColors } from "./chart-theme";
import { formatMetricValue, presentPointLabel } from "@/domain/custom-chart-vocabulary";

type MetricResult = { points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] };

/** Etiquetas de negocio para los puntos que son step types (sin desglose por atributo, ADR-057). */
export function presentResult(result: MetricResult, def: Pick<CustomMetricDefinitionDto, "groupByAttribute">): MetricResult {
  const map = (p: CustomMetricPointDto) => ({ ...p, label: presentPointLabel(p.label, def) });
  return { points: result.points.map(map), timeseries: result.timeseries.map((b) => ({ ...b, points: b.points.map(map) })) };
}

/** Opciones de ECharts a partir del resultado de un custom chart (ADR-027/030). Compartido entre el
 * builder (CustomChartsPanel) y la vista de un informe guardado (MetricReportView, ADR-035). */
export function customMetricChartOption(
  result: { points: CustomMetricPointDto[]; timeseries: { bucketStart: string; points: CustomMetricPointDto[] }[] },
  type: CustomMetricDefinitionDto["chartType"],
  isDark: boolean,
  metric: CustomMetricDefinitionDto["metric"] = "count",
): EChartsCoreOption {
  const c = chartColors(isDark);
  const fmt = (v: unknown) => formatMetricValue(metric, Number(v));
  const colors = c.series;

  if (type === "line" || type === "area") {
    const labels = [...new Set(result.timeseries.flatMap((b) => b.points.map((p) => p.label)))];
    const xData = result.timeseries.map((b) => new Date(b.bucketStart).toLocaleString());
    return {
      backgroundColor: "transparent",
      textStyle: { color: c.text },
      grid: { left: 6, right: 6, top: 28, bottom: 6, containLabel: true },
      legend: { top: 0, textStyle: { color: c.text, fontSize: 11 } },
      tooltip: { trigger: "axis", valueFormatter: fmt },
      xAxis: { type: "category", data: xData, axisLabel: { color: c.muted, fontSize: 11 }, axisLine: { lineStyle: { color: c.grid } } },
      yAxis: { type: "value", axisLabel: { color: c.muted, fontSize: 11, formatter: fmt }, splitLine: { lineStyle: { color: c.grid, type: "dashed" } } },
      series: labels.map((label, i) => ({
        name: label,
        type: "line",
        smooth: 0.3,
        showSymbol: false,
        areaStyle: type === "area" ? { opacity: 0.18, color: colors[i % colors.length] } : undefined,
        lineStyle: { width: 2.5, color: colors[i % colors.length] },
        data: result.timeseries.map((b) => b.points.find((p) => p.label === label)?.value ?? 0),
      })),
    };
  }

  if (type === "pie") {
    return {
      backgroundColor: "transparent",
      textStyle: { color: c.text },
      tooltip: { trigger: "item", valueFormatter: fmt },
      series: [
        {
          type: "pie",
          radius: ["40%", "70%"],
          data: result.points.map((p, i) => ({ name: p.label, value: p.value, itemStyle: { color: colors[i % colors.length] } })),
          label: { color: c.text, fontSize: 12, fontWeight: 600 },
        },
      ],
    };
  }

  // bar (default)
  return {
    backgroundColor: "transparent",
    textStyle: { color: c.text },
    grid: { left: 6, right: 6, top: 16, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: fmt },
    xAxis: { type: "category", data: result.points.map((p) => p.label), axisLabel: { color: c.muted, fontSize: 11 }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", axisLabel: { color: c.muted, fontSize: 11, formatter: fmt }, splitLine: { lineStyle: { color: c.grid, type: "dashed" } } },
    series: [
      {
        type: "bar",
        barMaxWidth: 44,
        data: result.points.map((p, i) => ({ value: p.value, itemStyle: { color: colors[i % colors.length], borderRadius: [4, 4, 0, 0] } })),
      },
    ],
  };
}
