import type { MetricsOverview, MetricsQuery } from "@/domain/metrics";
import type { Span } from "@/domain/span";
import type { Page, PageCursor, TraceSummary } from "@/domain/trace";
import type { TimeRange } from "@/domain/time-range";

export interface TraceListQuery extends TimeRange {
  service?: string;
  /** estado del span raíz */
  status?: "ok" | "error";
  /** true: la traza contiene algún span fallido */
  hasErrors?: boolean;
  minDurationMs?: number;
  limit: number;
  cursor?: PageCursor;
}

export interface TraceSpans {
  spans: Span[];
  truncated: boolean;
}

/**
 * Único punto de acceso al almacén (roadmap, pieza 4). Devuelve objetos de dominio planos:
 * el SQL, el esquema y el particionado no salen de la implementación.
 * Lanza `RepositoryUnavailableError` si el almacén no responde.
 */
export interface TraceRepository {
  listTraces(query: TraceListQuery): Promise<Page<TraceSummary>>;
  /** null si la traza no existe; con más de `maxSpans` spans devuelve los primeros y `truncated: true` */
  getTraceSpans(traceId: string, maxSpans: number): Promise<TraceSpans | null>;
  /** serie temporal *dispersa* (solo buckets con datos); el servicio la rellena */
  getOverview(query: MetricsQuery): Promise<MetricsOverview>;
  listServices(range: TimeRange): Promise<string[]>;
  ping(): Promise<void>;
}
