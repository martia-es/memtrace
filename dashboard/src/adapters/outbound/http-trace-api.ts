import type { TranscriptResponse, ConversationDetailResponse, ConversationListResponse, OverviewResponse, ProblemDetails, ServicesResponse, TraceDetailResponse, TraceListResponse } from "@contract";
import { ApiError, type ListConversationsParams, type ListTracesParams, type RangeParams, type TraceApi } from "@/application/trace-api";

type Fetch = typeof fetch;
type QueryValue = string | number | boolean | undefined;

/** Adapter HTTP del puerto TraceApi contra `/api/v1`. */
export class HttpTraceApi implements TraceApi {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  listTraces(params: ListTracesParams, signal?: AbortSignal) {
    return this.get<TraceListResponse>("/traces", { ...params }, signal);
  }

  getTrace(traceId: string, signal?: AbortSignal) {
    return this.get<TraceDetailResponse>(`/traces/${encodeURIComponent(traceId)}`, {}, signal);
  }

  getOverview(params: RangeParams & { service?: string }, signal?: AbortSignal) {
    return this.get<OverviewResponse>("/metrics/overview", { ...params }, signal);
  }

  listServices(params: RangeParams, signal?: AbortSignal) {
    return this.get<ServicesResponse>("/services", { ...params }, signal);
  }

  listConversations(params: ListConversationsParams, signal?: AbortSignal) {
    return this.get<ConversationListResponse>("/conversations", { ...params }, signal);
  }

  getConversation(conversationId: string, params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) {
    return this.get<ConversationDetailResponse>(`/conversations/${encodeURIComponent(conversationId)}`, { ...params }, signal);
  }

  getTranscript(conversationId: string, signal?: AbortSignal) {
    return this.get<TranscriptResponse>(`/conversations/${encodeURIComponent(conversationId)}/transcript`, {}, signal);
  }

  private async get<T>(path: string, query: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
    const qs = search.toString();

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}${qs ? `?${qs}` : ""}`, { signal, headers: { Accept: "application/json" } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "Sin conexión", "No se pudo contactar con la API de MemTrace.");
    }

    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as Partial<ProblemDetails>;
    return new ApiError(response.status, problem.title ?? response.statusText, problem.detail, problem.errors);
  } catch {
    return new ApiError(response.status, response.statusText || "Error", undefined);
  }
}
