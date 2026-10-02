import type {
  AttributeKeysResponse,
  AttributeValuesResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationTreeResponse,
  CustomMetricDefinitionDto,
  CustomMetricResultResponse,
  DatasetDto,
  DatasetItemDto,
  DatasetItemsListResponse,
  DatasetRunDetailResponse,
  DatasetRunsListResponse,
  DatasetsListResponse,
  DatasetVersionDto,
  DatasetVersionsListResponse,
  ExperimentUsageResponse,
  ModelPricingResponse,
  OverviewResponse,
  ProblemDetails,
  RunsListResponse,
  ServicesResponse,
  SpanListResponse,
  StepKindsResponse,
  TraceDetailResponse,
  TraceListResponse,
  TranscriptResponse,
} from "@contract";
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

  getModelPricing(signal?: AbortSignal) {
    return this.get<ModelPricingResponse>(`${this.baseUrl}/model-pricing`, {}, signal);
  }

  getStepKinds(params: RangeParams, signal?: AbortSignal) {
    return this.get<StepKindsResponse>(`${this.scopedBase()}/span-kinds`, { ...params }, signal);
  }

  getAttributeValues(params: RangeParams & { stepTypes: string[]; attribute: string }, signal?: AbortSignal) {
    const { stepTypes, ...rest } = params;
    return this.get<AttributeValuesResponse>(`${this.scopedBase()}/attribute-values`, { ...rest, stepTypes: stepTypes.join(",") }, signal);
  }

  getAttributeKeys(params: RangeParams & { stepTypes: string[] }, signal?: AbortSignal) {
    const { stepTypes, ...rest } = params;
    return this.get<AttributeKeysResponse>(`${this.scopedBase()}/attribute-keys`, { ...rest, stepTypes: stepTypes.join(",") }, signal);
  }

  queryCustomMetric(definition: CustomMetricDefinitionDto, range: RangeParams, signal?: AbortSignal) {
    return this.post<CustomMetricResultResponse>(`${this.scopedBase()}/metrics/custom`, { ...definition, ...range }, signal);
  }

  listDatasets(signal?: AbortSignal) {
    return this.get<DatasetsListResponse>(`${this.scopedBase()}/datasets`, {}, signal);
  }

  getDataset(datasetId: string, signal?: AbortSignal) {
    return this.get<DatasetDto>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}`, {}, signal);
  }

  createDataset(name: string, signal?: AbortSignal) {
    return this.post<DatasetDto>(`${this.scopedBase()}/datasets`, { name }, signal);
  }

  deleteDataset(datasetId: string, signal?: AbortSignal) {
    return this.del(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}`, signal);
  }

  listDatasetVersions(datasetId: string, signal?: AbortSignal) {
    return this.get<DatasetVersionsListResponse>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/versions`, {}, signal);
  }

  listDatasetVersionItemsWithDeleted(datasetId: string, versionId: string, signal?: AbortSignal) {
    return this.get<DatasetItemsListResponse>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/versions/${encodeURIComponent(versionId)}/items`, {}, signal);
  }

  listDatasetItems(datasetId: string, signal?: AbortSignal) {
    return this.get<DatasetItemsListResponse>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/items`, {}, signal);
  }

  async createDatasetItem(datasetId: string, item: { input: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }, signal?: AbortSignal) {
    const response = await this.post<DatasetItemsListResponse>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/items`, { items: [item] }, signal);
    return response.items[0]!;
  }

  updateDatasetItem(datasetId: string, itemId: string, patch: { input?: unknown; expectedOutput?: unknown; metadata?: Record<string, unknown> | null }, signal?: AbortSignal) {
    return this.put<DatasetItemDto>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(itemId)}`, patch, signal);
  }

  deleteDatasetItem(datasetId: string, itemId: string, signal?: AbortSignal) {
    return this.del(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/items/${encodeURIComponent(itemId)}`, signal);
  }

  listDatasetRuns(datasetId: string, signal?: AbortSignal) {
    return this.get<DatasetRunsListResponse>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/runs`, {}, signal);
  }

  listRuns(signal?: AbortSignal) {
    return this.get<RunsListResponse>(`${this.scopedBase()}/runs`, {}, signal);
  }

  getDatasetRun(datasetId: string, runId: string, signal?: AbortSignal) {
    return this.get<DatasetRunDetailResponse>(`${this.scopedBase()}/datasets/${encodeURIComponent(datasetId)}/runs/${encodeURIComponent(runId)}`, {}, signal);
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

  private async post<T>(fullPath: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(fullPath, {
        method: "POST",
        signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "No connection", "Could not reach the MemTrace API.");
    }
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  private async put<T>(fullPath: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(fullPath, {
        method: "PUT",
        signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "No connection", "Could not reach the MemTrace API.");
    }
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  private async del(fullPath: string, signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchFn(fullPath, { method: "DELETE", signal, headers: { Accept: "application/json" } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ApiError(0, "No connection", "Could not reach the MemTrace API.");
    }
    if (!response.ok) throw await toApiError(response);
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
