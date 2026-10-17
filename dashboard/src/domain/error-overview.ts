import { formatCount, formatPercent } from "./format";
import { tr } from "./translate";

export type Trend = { kind: "new" | "up" | "down" | "same"; label: string };

/** Variación frente al periodo anterior; null si no hay con qué comparar (fuera de retención). */
export function errorTrend(occurrences: number, previous: number, comparable: boolean): Trend | null {
  if (!comparable) return null;
  if (previous === 0) return occurrences === 0 ? { kind: "same", label: tr("error-overview.no_change") } : { kind: "new", label: tr("error-overview.new_in_this_period") };
  const change = (occurrences - previous) / previous;
  if (Math.abs(change) < 0.05) return { kind: "same", label: tr("error-overview.no_change") };
  return { kind: change > 0 ? "up" : "down", label: tr("error-overview.arrow_percent_vs_previous_period", { arrow: change > 0 ? "▲" : "▼", percent: formatPercent(Math.abs(change)) }) };
}

/** "12 conversations (24 % of all)"; sin conversaciones identificadas cae a las ejecuciones. */
export function impactLabel(conversations: number, totalConversations: number, traces: number): string {
  if (conversations > 0 && totalConversations > 0) {
    return `${formatCount(conversations)} ${conversations === 1 ? "conversation" : "conversations"} (${formatPercent(Math.min(1, conversations / totalConversations))})`;
  }
  return `${formatCount(traces)} ${traces === 1 ? "execution" : "executions"}`;
}
