import type { EChartsCoreOption } from "echarts/core";
import type { AgentSecurity } from "@/domain/agent-security";
import { chartColors } from "./chart-theme";

/** Detecciones por día (UTC) de los detectores de runtime, en barras. */
export function dailyEventsOption(daily: AgentSecurity["events"]["daily"], isDark: boolean): EChartsCoreOption {
  const c = chartColors(isDark);
  return {
    backgroundColor: "transparent",
    grid: { left: 36, right: 12, top: 12, bottom: 28 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: { type: "category", data: daily.map((d) => d.date.slice(5)), axisLabel: { color: c.muted }, axisLine: { lineStyle: { color: c.grid } } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: c.muted }, splitLine: { lineStyle: { color: c.grid } } },
    series: [{ type: "bar", data: daily.map((d) => d.count), itemStyle: { color: c.accent, borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 }],
  };
}
