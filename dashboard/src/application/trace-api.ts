import type { TranscriptResponse, ConversationDetailResponse, ConversationListResponse, OverviewResponse, ServicesResponse, TraceDetailResponse, TraceListResponse } from "@contract";

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

export interface ListConversationsParams extends RangeParams {
  service?: string;
  hasErrors?: boolean;
  limit?: number;
  cursor?: string;
}

/** Puerto de salida: lo que el dashboard necesita del backend. Es el único acceso a datos (roadmap, pieza 5). */
export interface TraceApi {
  listTraces(params: ListTracesParams, signal?: AbortSignal): Promise<TraceListResponse>;
  getTrace(traceId: string, signal?: AbortSignal): Promise<TraceDetailResponse>;
  getOverview(params: RangeParams & { service?: string }, signal?: AbortSignal): Promise<OverviewResponse>;
  listServices(params: RangeParams, signal?: AbortSignal): Promise<ServicesResponse>;
  listConversations(params: ListConversationsParams, signal?: AbortSignal): Promise<ConversationListResponse>;
  /** mensajes usuario/asistente por turno; `contentCaptured=false` si el agente no guardó contenido */
  getTranscript(conversationId: string, signal?: AbortSignal): Promise<TranscriptResponse>;
  /** resumen + turnos en orden cronológico */
  getConversation(conversationId: string, params?: { limit?: number; cursor?: string }, signal?: AbortSignal): Promise<ConversationDetailResponse>;
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
