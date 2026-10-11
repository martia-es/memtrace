import type { AnalyticsResponse } from "./contract";
import type { Analytics } from "@/domain/analytics";

export const toAnalyticsResponse = (a: Analytics): AnalyticsResponse => ({
  groupBy: a.groupBy,
  range: { from: new Date(a.range.fromMs).toISOString(), to: new Date(a.range.toMs).toISOString() },
  items: a.items.map((i) => ({ ...i, trend: i.trend.map((t) => ({ day: new Date(t.dayMs).toISOString(), traces: t.traces, errorTraces: t.errorTraces })) })),
  unpricedTokens: a.unpricedTokens,
});
