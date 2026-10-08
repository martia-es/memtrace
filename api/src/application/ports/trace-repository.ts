import type { ErrorGroupsResult } from "@/domain/error-categories";
import type { ConversationCursor, ConversationSummary, ConversationUsage } from "@/domain/conversation";
import type { AttributeKeyCount, AttributeValueCount, CustomMetricQuery, CustomMetricResult, MetricsOverview, MetricsQuery, ServiceUsage, StepKindCount } from "@/domain/metrics";
import type { ModelPricing } from "@/domain/pricing";
import type { ChatSpanRecord } from "@/domain/transcript";
import type { Span } from "@/domain/span";
import type { SpanCursor, SpanRecord } from "@/domain/span-row";
import type { Page, PageCursor, TraceStats, TraceSummary } from "@/domain/trace";
import type { TimeRange } from "@/domain/time-range";

export interface RevisionSummary {
  revision: string;
  traces: number;
  /** último momento (ms epoch) en que una traza de este commit llegó */
  lastSeenMs: number;
}

export interface TraceListQuery extends TimeRange {
  service?: string;
  /** estado del span raíz */
  status?: "ok" | "error";
  /** true: la traza contiene algún span fallido */
  hasErrors?: boolean;
  minDurationMs?: number;
  /** texto contenido en la entrada o salida capturadas de algún span de la traza (sin distinguir mayúsculas) */
  text?: string;
  /** solo los turnos de esta conversación */
  conversationId?: string;
  /** solo las trazas generadas por este commit (ADR-065) */
  revision?: string;
  /** solo las trazas con algún span que usó este prompt del registro, y opcionalmente esta versión (ADR-068) */
  promptName?: string;
  promptVersion?: number;
  /** desc (defecto): las más recientes primero; asc: cronológico (turnos de una conversación) */
  order?: "asc" | "desc";
  limit: number;
  cursor?: PageCursor;
}

export interface ConversationListQuery extends TimeRange {
  service?: string;
  /** true: la conversación contiene algún span fallido */
  hasErrors?: boolean;
  /** texto contenido en la entrada o salida capturadas de algún turno (sin distinguir mayúsculas) */
  text?: string;
  /** solo las conversaciones con algún turno generado por este commit, completo o prefijo (ADR-065) */
  revision?: string;
  limit: number;
  cursor?: ConversationCursor;
}

export interface SpanListQuery extends TimeRange {
  service?: string;
  /** tipo de paso (`memtrace.step_type`; los spans de GenAI sin él se clasifican por su operación) */
  kind?: string;
  model?: string;
  status?: "ok" | "error";
  /** texto contenido en la entrada o salida capturadas (sin distinguir mayúsculas) */
  text?: string;
  conversationId?: string;
  revision?: string;
  /** solo los spans que usaron este prompt del registro, y opcionalmente esta versión (ADR-068) */
  promptName?: string;
  promptVersion?: number;
  limit: number;
  cursor?: SpanCursor;
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
  /** spans de varias trazas en una sola consulta, agrupados por traceId; cada grupo se trunca a `maxSpansPerTrace` */
  getTraceSpansForTraces(traceIds: string[], maxSpansPerTrace: number): Promise<Map<string, TraceSpans>>;
  /** latencia y tokens por modelo de varias trazas en una sola consulta; las trazas que no existen (aún, o ya expiradas) no aparecen */
  getTraceStatsForTraces(traceIds: string[]): Promise<Map<string, TraceStats>>;
  /** serie temporal *dispersa* (solo buckets con datos); el servicio la rellena */
  getOverview(query: MetricsQuery): Promise<MetricsOverview>;
  listServices(range: TimeRange): Promise<string[]>;
  /** Versiones del código (commits) vistas en el rango, la más reciente primero, con cuántas trazas generó cada una (ADR-065). */
  listRevisions(range: TimeRange & { service?: string }): Promise<RevisionSummary[]>;
  /** tokens totales por servicio (= experimento) en el rango, para la comparativa de coste entre agentes */
  getUsageByServices(serviceNames: string[], range: TimeRange): Promise<ServiceUsage[]>;
  /** conversaciones con algún turno iniciado en el rango; sus cifras cubren toda su historia retenida */
  listConversations(query: ConversationListQuery): Promise<Page<ConversationSummary, ConversationCursor>>;
  /** Primer mensaje y tokens por modelo de esas conversaciones, para el título y el coste (ADR-049). Las que no existen no aparecen. */
  getConversationUsage(ids: string[], toMs: number): Promise<Map<string, ConversationUsage>>;
  /** Ids de las trazas (turnos) de esas conversaciones, para cruzarlas con las valoraciones humanas. Las que no existen no aparecen. */
  getConversationTraceIds(ids: string[], toMs: number): Promise<Map<string, string[]>>;
  /** null si no existe; `range` acota la búsqueda (la retención) */
  getConversation(conversationId: string, range: TimeRange): Promise<ConversationSummary | null>;
  /** spans de LLM de la conversación con su contenido capturado, cronológicos; hasta `maxSpans` (+ `truncated`) */
  getConversationMessages(conversationId: string, range: TimeRange, maxSpans: number): Promise<{ records: ChatSpanRecord[]; truncated: boolean }>;
  /** spans sueltos, los más recientes primero; el contenido llega crudo y el servicio lo resume */
  listSpans(query: SpanListQuery): Promise<Page<SpanRecord, SpanCursor>>;
  /** catálogo de precios vigente (ADR-025), un modelo por fila */
  getModelPricing(): Promise<ModelPricing[]>;

  /** `memtrace.step_type` distintos vistos en el rango, con conteo — alimenta el selector de tipo de paso (ADR-027) */
  getStepKinds(range: TimeRange & { service?: string }): Promise<StepKindCount[]>;
  /** valores distintos de un atributo, acotados a los step types dados — alimenta filtro/agrupación dinámicos (ADR-027) */
  getAttributeValues(query: TimeRange & { service?: string; stepTypes: string[]; attribute: string }): Promise<AttributeValueCount[]>;
  /** claves de atributo vistas en los step types dados — alimenta los selectores de "group by"/"filter by" (ADR-030) */
  getAttributeKeys(query: TimeRange & { service?: string; stepTypes: string[] }): Promise<AttributeKeyCount[]>;
  /** calcula un gráfico custom (ADR-027); la forma de la consulta es un enum cerrado, nunca SQL del usuario */
  getCustomMetric(query: CustomMetricQuery): Promise<CustomMetricResult>;

  /** spans fallidos más profundos (los que no tienen un hijo fallido) agrupados por señal técnica, más los totales del rango (ADR-066) */
  listErrorGroups(query: TimeRange & { service?: string }): Promise<ErrorGroupsResult>;

  ping(): Promise<void>;
}
