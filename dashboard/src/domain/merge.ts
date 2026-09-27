import type { ConversationSummaryDto, SpanListResponse, TraceListResponse, TraceSummaryDto } from "@contract";

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MergedList<T> {
  items: T[];
  nextCursor: string | null;
  /** items that were not in the list before this update */
  newKeys: string[];
}

/**
 * Integrates the first newly requested page (descending by `time`) with what the user already had loaded.
 * Updating should not discard pages loaded with "Load more": what's older than the first page is
 * kept and what already existed is replaced with its recent version.
 */
export function mergeLatestPage<T>(
  current: T[],
  currentCursor: string | null,
  latest: Paged<T>,
  key: (item: T) => string,
  time: (item: T) => number,
): MergedList<T> {
  const known = new Set(current.map(key));
  const newKeys = latest.items.filter((t) => !known.has(key(t))).map(key);

  // Primera página incompleta => contiene todo lo que hay: no queda nada "más antiguo" que conservar
  const oldest = latest.items.at(-1);
  if (latest.nextCursor === null || !oldest) return { items: latest.items, nextCursor: null, newKeys };

  const latestKeys = new Set(latest.items.map(key));
  const tail = current.filter((t) => !latestKeys.has(key(t)) && time(t) <= time(oldest));
  const loadedMore = tail.length > 0;
  return { items: [...latest.items, ...tail], nextCursor: loadedMore ? currentCursor : latest.nextCursor, newKeys };
}

export const mergeLatestTraces = (current: TraceSummaryDto[], cursor: string | null, latest: TraceListResponse) =>
  mergeLatestPage(current, cursor, latest, (t) => t.traceId, (t) => Date.parse(t.startTime));

export const mergeLatestConversations = (current: ConversationSummaryDto[], cursor: string | null, latest: Paged<ConversationSummaryDto>) =>
  mergeLatestPage(current, cursor, latest, (c) => c.conversationId, (c) => Date.parse(c.lastActivity));

export const mergeLatestSpans = (current: SpanListResponse["items"], cursor: string | null, latest: SpanListResponse) =>
  mergeLatestPage(current, cursor, latest, (s) => s.spanId, (s) => Date.parse(s.startTime));
