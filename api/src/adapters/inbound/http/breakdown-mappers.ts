import type { BreakdownResponse } from "./contract";
import type { Breakdown } from "@/domain/breakdown";

export const toBreakdownResponse = (a: Breakdown): BreakdownResponse => ({
  groupBy: a.groupBy,
  range: { from: new Date(a.range.fromMs).toISOString(), to: new Date(a.range.toMs).toISOString() },
  items: a.items.map((i) => ({ ...i, trend: i.trend.map((t) => ({ day: new Date(t.dayMs).toISOString(), traces: t.traces, errorTraces: t.errorTraces })) })),
  unpricedTokens: a.unpricedTokens,
});
