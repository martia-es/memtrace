import type { SpanListResponse, TranscriptResponse, ConversationDetailResponse, ConversationListResponse, ConversationTreeResponse, ExperimentUsageResponse, OverviewResponse, ProblemDetails, ServicesResponse, TraceDetailResponse, TraceListResponse } from "@contract";
import { ApiError, type ListConversationsParams, type ListSpansParams, type ListTracesParams, type RangeParams, type TraceApi } from "@/application/trace-api";

type Fetch = typeof fetch;
type QueryValue = string | number | boolean | undefined;

/** Adapter HTTP del puerto TraceApi contra `/api/v1/experiments/{experimentId}` (ADR-013). */
export class HttpTraceApi implements TraceApi {
  private experimentId: string | null = null;

  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  /** Fijado por el router al entrar en `/e/:experimentId/...` (ver router.ts). */
  setExperimentId(experimentId: string): void {
    this.experimentId = experimentId;
  }

  private scopedBase(): string {
    if (!this.experimentId) throw new Error("HttpTraceApi: no experiment selected");
    return `${this.baseUrl}/experiments/${encodeURIComponent(this.experimentId)}`;
  }

  listTraces(params: ListTracesParams, signal?: AbortSignal) {
    return this.get<TraceListResponse>(`${this.scopedBase()}/traces`, { ...params }, signal);
  }

  listSpans(params: ListSpansParams, signal?: AbortSignal) {
    return this.get<SpanListResponse>(`${this.scopedBase()}/spans`, { ...params }, signal);
  }

  getTrace(traceId: string, signal?: AbortSignal) {
    return this.get<TraceDetailResponse>(`${this.scopedBase()}/traces/${encodeURIComponent(traceId)}`, {}, signal);
  }

  getOverview(params: RangeParams & { service?: string }, signal?: AbortSignal) {
    return this.get<OverviewResponse>(`${this.scopedBase()}/metrics/overview`, { ...params }, signal);
  }

  getOverviewForExperiment(experimentId: string, params: RangeParams & { service?: string }, signal?: AbortSignal) {
    return this.get<OverviewResponse>(`${this.baseUrl}/experiments/${encodeURIComponent(experimentId)}/metrics/overview`, { ...params }, signal);
  }

  listServices(params: RangeParams, signal?: AbortSignal) {
    return this.get<ServicesResponse>(`${this.baseUrl}/services`, { ...params }, signal);
  }

  getUsageByExperiment(params: RangeParams, signal?: AbortSignal) {
    return this.get<ExperimentUsageResponse>(`${this.baseUrl}/experiments/usage`, { ...params }, signal);
  }

  listConversations(params: ListConversationsParams, signal?: AbortSignal) {
    return this.get<ConversationListResponse>(`${this.scopedBase()}/conversations`, { ...params }, signal);
  }

  getConversation(conversationId: string, params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) {
    return this.get<ConversationDetailResponse>(`${this.scopedBase()}/conversations/${encodeURIComponent(conversationId)}`, { ...params }, signal);
  }

  getConversationTree(conversationId: string, params: { limit?: number; cursor?: string } = {}, signal?: AbortSignal) {
    return this.get<ConversationTreeResponse>(`${this.scopedBase()}/conversations/${encodeURIComponent(conversationId)}/tree`, { ...params }, signal);
  }

  getTranscript(conversationId: string, signal?: AbortSignal) {
    return this.get<TranscriptResponse>(`${this.scopedBase()}/conversations/${encodeURIComponent(conversationId)}/transcript`, {}, signal);
  }

  private async get<T>(fullPath: string, query: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
    const qs = search.toString();

    let response: Response;
    try {
      response = await this.fetchFn(`${fullPath}${qs ? `?${qs}` : ""}`, { signal, headers: { Accept: "application/json" } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "No connection", "Could not reach the MemTrace API.");
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
