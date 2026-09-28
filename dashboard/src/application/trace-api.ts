import type { SpanListResponse, TranscriptResponse, ConversationDetailResponse, ConversationListResponse, ConversationTreeResponse, ExperimentUsageResponse, OverviewResponse, ServicesResponse, TraceDetailResponse, TraceListResponse } from "@contract";

export interface RangeParams {
  from: string;
  to: string;
}

export interface ListTracesParams extends RangeParams {
  service?: string;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  conversationId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListSpansParams extends RangeParams {
  service?: string;
  kind?: string;
  model?: string;
  status?: "ok" | "error";
  /** texto contenido en la entrada o la salida capturadas */
  text?: string;
  conversationId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListConversationsParams extends RangeParams {
  service?: string;
  hasErrors?: boolean;
  limit?: number;
  cursor?: string;
}

/** Puerto de salida: lo que el dashboard necesita del backend. Es el único acceso a datos (roadmap, pieza 5). */
export interface TraceApi {
  listTraces(params: ListTracesParams, signal?: AbortSignal): Promise<TraceListResponse>;
  /** spans sueltos (más recientes primero) con una vista previa de su entrada y salida */
  listSpans(params: ListSpansParams, signal?: AbortSignal): Promise<SpanListResponse>;
  getTrace(traceId: string, signal?: AbortSignal): Promise<TraceDetailResponse>;
  getOverview(params: RangeParams & { service?: string }, signal?: AbortSignal): Promise<OverviewResponse>;
  /** igual que getOverview pero para un experimento explícito, sin depender del scoping por setExperimentId (comparativa entre agentes) */
  getOverviewForExperiment(experimentId: string, params: RangeParams & { service?: string }, signal?: AbortSignal): Promise<OverviewResponse>;
  listServices(params: RangeParams, signal?: AbortSignal): Promise<ServicesResponse>;
  /** tokens por experimento accesible al usuario, para la comparativa de coste entre agentes */
  getUsageByExperiment(params: RangeParams, signal?: AbortSignal): Promise<ExperimentUsageResponse>;
  listConversations(params: ListConversationsParams, signal?: AbortSignal): Promise<ConversationListResponse>;
  /** mensajes usuario/asistente por turno; `contentCaptured=false` si el agente no guardó contenido */
  getTranscript(conversationId: string, signal?: AbortSignal): Promise<TranscriptResponse>;
  /** resumen + turnos en orden cronológico */
  getConversation(conversationId: string, params?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ConversationDetailResponse>;
  /** árbol de spans de cada turno, en el mismo orden y página que getConversation (vista de árbol unificado) */
  getConversationTree(conversationId: string, params?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ConversationTreeResponse>;
}

/** Error de la API (RFC 7807) o de conexión (`status === 0`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(detail ?? title);
    this.name = "ApiError";
  }
}
