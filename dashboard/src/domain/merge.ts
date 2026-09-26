import type { TraceListResponse, TraceSummaryDto } from "@contract";

export interface MergedList {
  items: TraceSummaryDto[];
  nextCursor: string | null;
  /** trazas que no estaban en la lista antes de esta actualización */
  newIds: string[];
}

/**
 * Integra la primera página recién pedida con lo que el usuario ya tenía cargado.
 * Actualizar no debe tirar las páginas que cargó con "Cargar más": las trazas más antiguas que las de la
 * primera página se conservan y las que ya existían se reemplazan por su versión reciente.
 */
export function mergeLatest(current: TraceSummaryDto[], currentCursor: string | null, latest: TraceListResponse): MergedList {
  const known = new Set(current.map((t) => t.traceId));
  const newIds = latest.items.filter((t) => !known.has(t.traceId)).map((t) => t.traceId);

  // Primera página incompleta => contiene todo lo que hay: no queda nada "más antiguo" que conservar
  const oldest = latest.items.at(-1);
  if (latest.nextCursor === null || !oldest) return { items: latest.items, nextCursor: null, newIds };

  const latestIds = new Set(latest.items.map((t) => t.traceId));
  const tail = current.filter((t) => !latestIds.has(t.traceId) && Date.parse(t.startTime) <= Date.parse(oldest.startTime));
  const loadedMore = tail.length > 0;
  return { items: [...latest.items, ...tail], nextCursor: loadedMore ? currentCursor : latest.nextCursor, newIds };
}
