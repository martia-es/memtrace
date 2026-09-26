import type { ConversationSummaryDto, TraceListResponse, TraceSummaryDto } from "@contract";

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MergedList<T> {
  items: T[];
  nextCursor: string | null;
  /** elementos que no estaban en la lista antes de esta actualización */
  newKeys: string[];
}

/**
 * Integra la primera página recién pedida (orden descendente por `time`) con lo que el usuario ya tenía cargado.
 * Actualizar no debe tirar las páginas que cargó con "Cargar más": lo más antiguo que la primera página se
 * conserva y lo que ya existía se reemplaza por su versión reciente.
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
