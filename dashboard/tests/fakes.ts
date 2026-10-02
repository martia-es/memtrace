import type {
  AttributeKeysResponse,
  AttributeValuesResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummaryDto,
  ConversationTreeResponse,
  CustomMetricDefinitionDto,
  CustomMetricResultResponse,
  DatasetDto,
  DatasetRunDetailResponse,
  DatasetRunItemResultDto,
  DatasetRunSummaryDto,
  DatasetRunsListResponse,
  DatasetsListResponse,
  ScoreAggregateDto,
  ExperimentUsageResponse,
  ModelPricingResponse,
  OverviewResponse,
  ServicesResponse,
  SpanListResponse,
  SpanNodeDto,
  SpanRowDto,
  StepKindsResponse,
  TraceDetailResponse,
  TraceListResponse,
  TraceSummaryDto,
  TranscriptResponse,
} from "@contract";
import type { ListConversationsParams, ListSpansParams, ListTracesParams, RangeParams, TraceApi } from "@/application/trace-api";
import type { ApiKeyDto, CurrentUser, ExperimentDto, IdentityApi, MembersResponseDto, OrganizationDto, OrganizationThemeDto, SavedCustomMetricDto } from "@/application/identity-api";

const NO_THEME: OrganizationThemeDto = { accentColor: null, radiusPreset: null };

/** Puerto de identidad (ADR-013): usada solo por OnboardingGuide en estas pruebas de UI, sin sesión real. */
export class FakeIdentityApi implements IdentityApi {
  async getMe(): Promise<CurrentUser | null> {
    return null;
  }
  async listOrganizations(): Promise<OrganizationDto[]> {
    return [];
  }
  async createOrganization(name: string): Promise<OrganizationDto> {
    return { id: "org-1", name, myRole: "org_admin", theme: NO_THEME };
  }
  async addOrgAdmin(): Promise<void> {}
  async listOrgMembers(): Promise<MembersResponseDto> {
    return { members: [], pendingInvitations: [] };
  }
  async updateOrganizationTheme(organizationId: string, theme: OrganizationThemeDto): Promise<OrganizationDto> {
    return { id: organizationId, name: "org", myRole: "org_admin", theme };
  }
  async listExperiments(): Promise<ExperimentDto[]> {
    return [];
  }
  async createExperiment(organizationId: string, name: string, serviceName: string): Promise<ExperimentDto> {
    return { id: "exp-1", organizationId, name, serviceName, myRole: "org_admin", organizationTheme: NO_THEME };
  }
  async addExperimentMember(): Promise<void> {}
  async listExperimentMembers(): Promise<MembersResponseDto> {
    return { members: [], pendingInvitations: [] };
  }
  async listApiKeys(): Promise<ApiKeyDto[]> {
    return [];
  }
  async createApiKey(experimentId: string): Promise<ApiKeyDto & { plaintext: string }> {
    return { id: "key-1", experimentId, keyPrefix: "mtk_test", createdAt: new Date().toISOString(), lastUsedAt: null, plaintext: "mtk_test-plaintext" };
  }
  async revokeApiKey(): Promise<void> {}
  async listCustomMetrics(): Promise<SavedCustomMetricDto[]> {
    return [];
  }
  async createCustomMetric(experimentId: string, name: string, definition: CustomMetricDefinitionDto): Promise<SavedCustomMetricDto> {
    return { id: "metric-1", name, definition, createdAt: new Date().toISOString() };
  }
  async deleteCustomMetric(): Promise<void> {}
}

export function summary(overrides: Partial<TraceSummaryDto> = {}): TraceSummaryDto {
  return {
    traceId: "a".repeat(32),
    rootSpanName: "agente",
    serviceName: "svc",
    startTime: new Date().toISOString(),
    durationMs: 120,
    status: "ok",
    spanCount: 3,
    errorCount: 0,
    totalTokens: 0,
    input: null,
    output: null,
    conversationId: null,
    ...overrides,
  };
}

export function conversation(overrides: Partial<ConversationSummaryDto> = {}): ConversationSummaryDto {
  return {
    conversationId: "conv-1",
    serviceNames: ["svc"],
    startTime: "2026-09-26T12:00:00.000Z",
    lastActivity: "2026-09-26T12:05:00.000Z",
    turnCount: 2,
    errorTurns: 0,
    failedSpans: 0,
    totalTokens: 0,
    activeMs: 100,
    ...overrides,
  };
}

export function spanRow(overrides: Partial<SpanRowDto> = {}): SpanRowDto {
  return {
    spanId: "b".repeat(16),
    traceId: "a".repeat(32),
    parentSpanId: null,
    conversationId: null,
    name: "tool.search",
    kind: "tool",
    serviceName: "svc",
    startTime: "2026-09-26T12:00:00.000Z",
    durationMs: 50,
    status: "ok",
    model: null,
    totalTokens: null,
    costUsd: null,
    input: null,
    output: null,
    ...overrides,
  };
}

export function node(overrides: Partial<SpanNodeDto> = {}): SpanNodeDto {
  return {
    spanId: "s1",
    parentSpanId: null,
    name: "span",
    kind: "chain",
    serviceName: "svc",
    startTime: "2026-09-26T12:00:00.000Z",
    offsetMs: 0,
    durationMs: 10,
    status: { code: "ok", message: null },
    orphan: false,
    genAi: null,
    costUsd: null,
    content: null,
    framework: null,
    attributes: {},
    events: [],
    children: [],
    ...overrides,
  };
}

export function traceDetail(overrides: Partial<TraceDetailResponse> = {}): TraceDetailResponse {
  return {
    traceId: "a".repeat(32),
    startTime: "2026-09-26T12:00:00.000Z",
    durationMs: 120,
    status: "ok",
    spanCount: 1,
    errorCount: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    truncated: false,
    conversationId: null,
    framework: null,
    roots: [node()],
    ...overrides,
  };
}

export function scoreAggregate(overrides: Partial<ScoreAggregateDto> = {}): ScoreAggregateDto {
  return { name: "exact_match", dataType: "boolean", passRate: 0.66, average: null, count: 3, ...overrides };
}

export function datasetDto(overrides: Partial<DatasetDto> = {}): DatasetDto {
  return {
    id: "ds-1",
    name: "toy-agent-smoke-test",
    createdAt: "2026-09-30T22:45:54Z",
    runCount: 1,
    lastRun: { id: "run-1", name: "toy-agent-v1", createdAt: "2026-09-30T22:45:54Z", itemCount: 3, aggregates: [scoreAggregate()] },
    ...overrides,
  };
}

export function datasetRunSummary(overrides: Partial<DatasetRunSummaryDto> = {}): DatasetRunSummaryDto {
  return { id: "run-1", name: "toy-agent-v1", itemCount: 3, createdAt: "2026-09-30T22:45:54Z", aggregates: [scoreAggregate()], ...overrides };
}

export function datasetRunItem(overrides: Partial<DatasetRunItemResultDto> = {}): DatasetRunItemResultDto {
  return {
    itemIndex: 0,
    input: "2+2?",
    expectedOutput: "4",
    output: "4",
    traceId: "abc123",
    error: null,
    scores: [{ name: "exact_match", value: "true", dataType: "boolean", source: "code", comment: null }],
    ...overrides,
  };
}

/** Implementación en memoria del puerto: prueba la UI sin red. */
export class FakeTraceApi implements TraceApi {
  pages: TraceListResponse[] = [{ items: [], nextCursor: null }];
  listCalls: ListTracesParams[] = [];
  detail: TraceDetailResponse | Error | null = null;
  services = ["svc-a", "svc-b"];
  overview: OverviewResponse | null = null;
  usageByExperiment: ExperimentUsageResponse["items"] = [];
  modelPricing: ModelPricingResponse["items"] = [];

  async listTraces(params: ListTracesParams) {
    this.listCalls.push(params);
    const index = params.cursor ? Number(params.cursor) : 0;
    return this.pages[index] ?? { items: [], nextCursor: null };
  }
  spanPages: SpanListResponse[] = [{ items: [], nextCursor: null }];
  spanCalls: ListSpansParams[] = [];
  async listSpans(params: ListSpansParams) {
    this.spanCalls.push(params);
    return this.spanPages[params.cursor ? Number(params.cursor) : 0] ?? { items: [], nextCursor: null };
  }
  conversationPages: ConversationListResponse[] = [{ items: [], nextCursor: null }];
  conversationCalls: ListConversationsParams[] = [];
  conversationDetail: ConversationDetailResponse | Error | null = null;
  transcript: TranscriptResponse | Error | null = null;
  transcriptCalls = 0;
  conversationDetailCalls: { id: string; limit?: number; cursor?: string }[] = [];

  async listConversations(params: ListConversationsParams) {
    this.conversationCalls.push(params);
    return this.conversationPages[params.cursor ? Number(params.cursor) : 0] ?? { items: [], nextCursor: null };
  }
  async getTranscript() {
    this.transcriptCalls += 1;
    if (this.transcript instanceof Error) throw this.transcript;
    if (!this.transcript) throw new Error("no transcript configured");
    return this.transcript;
  }
  async getConversation(id: string, params: { limit?: number; cursor?: string } = {}) {
    this.conversationDetailCalls.push({ id, ...params });
    if (this.conversationDetail instanceof Error) throw this.conversationDetail;
    if (!this.conversationDetail) throw new Error("no conversation configured");
    return this.conversationDetail;
  }

  conversationTree: ConversationTreeResponse | Error | null = null;
  conversationTreeCalls: { id: string; limit?: number; cursor?: string }[] = [];
  async getConversationTree(id: string, params: { limit?: number; cursor?: string } = {}) {
    this.conversationTreeCalls.push({ id, ...params });
    if (this.conversationTree instanceof Error) throw this.conversationTree;
    if (!this.conversationTree) throw new Error("no conversation tree configured");
    return this.conversationTree;
  }

  traceCalls = 0;
  async getTrace() {
    this.traceCalls += 1;
    if (this.detail instanceof Error) throw this.detail;
    if (!this.detail) throw new Error("no detail configured");
    return this.detail;
  }
  async getOverview(_p: RangeParams & { service?: string }) {
    if (!this.overview) throw new Error("no overview configured");
    return this.overview;
  }
  overviewByExperiment: Record<string, OverviewResponse> = {};
  async getOverviewForExperiment(experimentId: string, _p: RangeParams & { service?: string }) {
    const found = this.overviewByExperiment[experimentId];
    if (!found) throw new Error(`no overview configured for ${experimentId}`);
    return found;
  }
  async listServices(_p: RangeParams): Promise<ServicesResponse> {
    return { items: this.services };
  }
  async getUsageByExperiment(_p: RangeParams): Promise<ExperimentUsageResponse> {
    return { items: this.usageByExperiment };
  }
  async getModelPricing(): Promise<ModelPricingResponse> {
    return { items: this.modelPricing };
  }
  async getStepKinds(): Promise<StepKindsResponse> {
    return { items: [] };
  }
  async getAttributeValues(): Promise<AttributeValuesResponse> {
    return { items: [] };
  }
  async getAttributeKeys(): Promise<AttributeKeysResponse> {
    return { items: [] };
  }
  async queryCustomMetric(_definition: CustomMetricDefinitionDto): Promise<CustomMetricResultResponse> {
    return { points: [], timeseries: [] };
  }

  datasets: DatasetsListResponse = { items: [] };
  async listDatasets(): Promise<DatasetsListResponse> {
    return this.datasets;
  }
  datasetRuns: Record<string, DatasetRunsListResponse> = {};
  async listDatasetRuns(datasetId: string): Promise<DatasetRunsListResponse> {
    return this.datasetRuns[datasetId] ?? { items: [] };
  }
  datasetRunDetail: DatasetRunDetailResponse | Error | null = null;
  async getDatasetRun(): Promise<DatasetRunDetailResponse> {
    if (this.datasetRunDetail instanceof Error) throw this.datasetRunDetail;
    if (!this.datasetRunDetail) throw new Error("no dataset run configured");
    return this.datasetRunDetail;
  }
}
