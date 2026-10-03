import type {
  AddQueueItemsResponse,
  InterAnnotatorAgreementResponse,
  JudgeHumanAgreementResponse,
  AnnotationQueueDetailResponse,
  AnnotationQueueDto,
  AnnotationQueueSummaryDto,
  AnnotationQueuesListResponse,
  NextQueueItemResponse,
  QueueItemDto,
  QueueItemsResponse,
  AttributeKeysResponse,
  AttributeValuesResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummaryDto,
  ConversationTreeResponse,
  CustomMetricDefinitionDto,
  ScoreConfigDto,
  TraceAnnotationsResponse,
  CustomMetricResultResponse,
  DatasetDto,
  CommitDatasetChangesBody,
  DatasetItemDto,
  DatasetItemsListResponse,
  DatasetRunDetailResponse,
  DatasetRunItemResultDto,
  DatasetRunSummaryDto,
  DatasetRunsListResponse,
  DatasetsListResponse,
  DatasetVersionDiffResponse,
  DatasetVersionDto,
  DatasetVersionsListResponse,
  RunListItemDto,
  RunsListResponse,
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
import type { ListConversationsParams, ListSpansParams, ListTracesParams, RangeParams, SaveAnnotationBody, TraceApi, AddQueueItemsBody, AnnotationQueuePatchBody, NewAnnotationQueueBody, QueueLabelBody, AgreementScope } from "@/application/trace-api";
import type {
  ApiKeyDto,
  CurrentUser,
  ExperimentDto,
  IdentityApi,
  MembersResponseDto,
  MetricReportDto,
  NewScoreConfigInput,
  ScoreConfigPatchInput,
  MetricReportSummaryDto,
  OrganizationDto,
  OrganizationThemeDto,
  SavedCustomMetricDto,
} from "@/application/identity-api";

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
  scoreConfigs: ScoreConfigDto[] = [];
  async listScoreConfigs(_experimentId: string, includeArchived = false): Promise<ScoreConfigDto[]> {
    return this.scoreConfigs.filter((c) => includeArchived || !c.archivedAt);
  }
  async createScoreConfig(_experimentId: string, input: NewScoreConfigInput): Promise<ScoreConfigDto> {
    const now = new Date().toISOString();
    const config: ScoreConfigDto = {
      id: `cfg-${this.scoreConfigs.length + 1}`,
      name: input.name,
      dataType: input.dataType,
      minValue: input.minValue ?? null,
      maxValue: input.maxValue ?? null,
      categories: input.categories ?? null,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    this.scoreConfigs.push(config);
    return config;
  }
  async updateScoreConfig(_experimentId: string, configId: string, patch: ScoreConfigPatchInput): Promise<ScoreConfigDto> {
    const config = this.scoreConfigs.find((c) => c.id === configId)!;
    Object.assign(config, patch);
    return config;
  }
  async archiveScoreConfig(_experimentId: string, configId: string): Promise<ScoreConfigDto> {
    const config = this.scoreConfigs.find((c) => c.id === configId)!;
    config.archivedAt = new Date().toISOString();
    return config;
  }
  async unarchiveScoreConfig(_experimentId: string, configId: string): Promise<ScoreConfigDto> {
    const config = this.scoreConfigs.find((c) => c.id === configId)!;
    config.archivedAt = null;
    return config;
  }
  async listMetricReports(): Promise<MetricReportSummaryDto[]> {
    return [];
  }
  async createMetricReport(experimentId: string, name: string): Promise<MetricReportSummaryDto> {
    return { id: "report-1", name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  async getMetricReport(experimentId: string, reportId: string): Promise<MetricReportDto> {
    return { id: reportId, name: "report", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), charts: [] };
  }
  async renameMetricReport(experimentId: string, reportId: string, name: string): Promise<MetricReportDto> {
    return { id: reportId, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), charts: [] };
  }
  async deleteMetricReport(): Promise<void> {}
  async setMetricReportCharts(experimentId: string, reportId: string): Promise<MetricReportDto> {
    return { id: reportId, name: "report", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), charts: [] };
  }
  async sendMetricReportEmail(): Promise<void> {}
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
  return { name: "exact_match", dataType: "boolean", passRate: 0.66, average: null, count: 3, judges: [], ...overrides };
}

export function datasetDto(overrides: Partial<DatasetDto> = {}): DatasetDto {
  return {
    id: "ds-1",
    name: "toy-agent-smoke-test",
    createdAt: "2026-09-30T22:45:54Z",
    runCount: 1,
    versionCount: 1,
    latestVersionMajor: 1,
    latestVersionMinor: 0,
    lastRun: { id: "run-1", name: "toy-agent-v1", createdAt: "2026-09-30T22:45:54Z", itemCount: 3, aggregates: [scoreAggregate()] },
    ...overrides,
  };
}

export function datasetVersionDto(overrides: Partial<DatasetVersionDto> = {}): DatasetVersionDto {
  return { id: "ver-1", major: 1, minor: 0, note: null, createdByEmail: "maria@example.com", createdAt: "2026-09-30T22:45:54Z", itemCount: 3, addedCount: 0, modifiedCount: 0, removedCount: 0, ...overrides };
}

export function datasetItemDto(overrides: Partial<DatasetItemDto> = {}): DatasetItemDto {
  return {
    id: "item-1",
    datasetVersionId: "ver-1",
    input: "2+2?",
    expectedOutput: "4",
    metadata: null,
    createdByEmail: "maria@example.com",
    createdAt: "2026-09-30T22:45:54Z",
    updatedByEmail: null,
    updatedAt: null,
    deletedByEmail: null,
    deletedAt: null,
    ...overrides,
  };
}

export function datasetRunSummary(overrides: Partial<DatasetRunSummaryDto> = {}): DatasetRunSummaryDto {
  return { id: "run-1", name: "toy-agent-v1", versionMajor: 1, versionMinor: 0, itemCount: 3, status: "completed", createdAt: "2026-09-30T22:45:54Z", aggregates: [scoreAggregate()], ...overrides };
}

export function runListItem(overrides: Partial<RunListItemDto> = {}): RunListItemDto {
  return { ...datasetRunSummary(), datasetId: "ds-1", datasetName: "toy-agent-smoke-test", ...overrides };
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

  // ---- colas de anotación (ADR-039) ----
  queues: AnnotationQueueSummaryDto[] = [];
  queueDetail: AnnotationQueueDetailResponse | null = null;
  queueItems: QueueItemDto[] = [];
  /** items que `next` va entregando, en orden; vacío = no queda nada */
  nextItems: QueueItemDto[] = [];
  createdQueues: NewAnnotationQueueBody[] = [];
  queuePatches: Array<{ queueId: string; patch: AnnotationQueuePatchBody }> = [];
  addedToQueue: Array<{ queueId: string; body: AddQueueItemsBody }> = [];
  completed: Array<{ queueId: string; itemId: string; labels: QueueLabelBody[] }> = [];
  skipped: string[] = [];
  unreviewable: string[] = [];
  async listAnnotationQueues(): Promise<AnnotationQueuesListResponse> {
    return { items: this.queues };
  }
  async createAnnotationQueue(body: NewAnnotationQueueBody): Promise<AnnotationQueueDto> {
    this.createdQueues.push(body);
    return { id: "q-new", name: body.name, instructions: body.instructions ?? null, requiredAnnotations: body.requiredAnnotations, rubric: body.rubric, createdAt: "2026-10-03T00:00:00.000Z", archivedAt: null };
  }
  async getAnnotationQueue(): Promise<AnnotationQueueDetailResponse> {
    if (!this.queueDetail) throw new Error("no queue detail configured");
    return this.queueDetail;
  }
  async updateAnnotationQueue(queueId: string, patch: AnnotationQueuePatchBody): Promise<AnnotationQueueDetailResponse> {
    this.queuePatches.push({ queueId, patch });
    return this.getAnnotationQueue();
  }
  async listAnnotationQueueItems(): Promise<QueueItemsResponse> {
    return { items: this.queueItems };
  }
  async addAnnotationQueueItems(queueId: string, body: AddQueueItemsBody): Promise<AddQueueItemsResponse> {
    this.addedToQueue.push({ queueId, body });
    return { added: 1, duplicates: 0 };
  }
  async nextAnnotationQueueItem(): Promise<NextQueueItemResponse> {
    return { item: this.nextItems.shift() ?? null };
  }
  async completeAnnotationQueueItem(queueId: string, itemId: string, labels: QueueLabelBody[]): Promise<QueueItemDto> {
    this.completed.push({ queueId, itemId, labels });
    return { ...queueItemDto({ id: itemId }), status: "completed" };
  }
  async skipAnnotationQueueItem(_queueId: string, itemId: string): Promise<QueueItemDto> {
    this.skipped.push(itemId);
    return queueItemDto({ id: itemId });
  }
  async markAnnotationQueueItemUnreviewable(_queueId: string, itemId: string): Promise<QueueItemDto> {
    this.unreviewable.push(itemId);
    return { ...queueItemDto({ id: itemId }), status: "skipped" };
  }

  annotations: TraceAnnotationsResponse = { annotations: [], scores: [] };
  savedAnnotations: SaveAnnotationBody[] = [];
  retractions: Array<{ traceId: string; configId: string; spanId?: string | null; annotatorId?: string }> = [];
  async listTraceAnnotations() {
    return this.annotations;
  }
  async saveTraceAnnotation(_traceId: string, body: SaveAnnotationBody) {
    this.savedAnnotations.push(body);
    return this.annotations;
  }
  async retractTraceAnnotation(traceId: string, configId: string, options: { spanId?: string | null; annotatorId?: string } = {}) {
    this.retractions.push({ traceId, configId, ...options });
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
  datasetById: Record<string, DatasetDto> = {};
  async getDataset(datasetId: string): Promise<DatasetDto> {
    const found = this.datasetById[datasetId];
    if (!found) throw new Error(`no dataset configured for ${datasetId}`);
    return found;
  }
  createDatasetCalls: string[] = [];
  createdDataset: DatasetDto = datasetDto();
  async createDataset(name: string): Promise<DatasetDto> {
    this.createDatasetCalls.push(name);
    return this.createdDataset;
  }
  deleteDatasetCalls: string[] = [];
  async deleteDataset(datasetId: string): Promise<void> {
    this.deleteDatasetCalls.push(datasetId);
  }

  datasetVersions: Record<string, DatasetVersionsListResponse> = {};
  async listDatasetVersions(datasetId: string): Promise<DatasetVersionsListResponse> {
    return this.datasetVersions[datasetId] ?? { items: [] };
  }
  datasetVersionItemsWithDeleted: Record<string, DatasetItemsListResponse> = {};
  async listDatasetVersionItemsWithDeleted(_datasetId: string, versionId: string): Promise<DatasetItemsListResponse> {
    return this.datasetVersionItemsWithDeleted[versionId] ?? { items: [] };
  }

  datasetItems: Record<string, DatasetItemsListResponse> = {};
  /** Clave: `${versionId}:${againstVersionId ?? ""}`. */
  datasetVersionDiffs: Record<string, DatasetVersionDiffResponse> = {};
  datasetVersionDiffCalls: Array<{ versionId: string; againstVersionId?: string }> = [];
  async getDatasetVersionDiff(_datasetId: string, versionId: string, againstVersionId?: string): Promise<DatasetVersionDiffResponse> {
    this.datasetVersionDiffCalls.push({ versionId, againstVersionId });
    return this.datasetVersionDiffs[`${versionId}:${againstVersionId ?? ""}`] ?? { base: null, target: { id: versionId, major: 1, minor: 0 }, unchangedCount: 0, changes: [] };
  }
  async listDatasetItems(datasetId: string): Promise<DatasetItemsListResponse> {
    return this.datasetItems[datasetId] ?? { items: [] };
  }
  createDatasetItemCalls: { datasetId: string; item: unknown }[] = [];
  createdDatasetItem: DatasetItemDto = datasetItemDto();
  async createDatasetItem(datasetId: string, item: unknown): Promise<DatasetItemDto> {
    this.createDatasetItemCalls.push({ datasetId, item });
    return this.createdDatasetItem;
  }
  updateDatasetItemCalls: { datasetId: string; itemId: string; patch: unknown }[] = [];
  updatedDatasetItem: DatasetItemDto = datasetItemDto();
  async updateDatasetItem(datasetId: string, itemId: string, patch: unknown): Promise<DatasetItemDto> {
    this.updateDatasetItemCalls.push({ datasetId, itemId, patch });
    return this.updatedDatasetItem;
  }
  commitDatasetChangesCalls: { datasetId: string; changes: CommitDatasetChangesBody }[] = [];
  commitDatasetChangesError: Error | null = null;
  async commitDatasetChanges(datasetId: string, changes: CommitDatasetChangesBody): Promise<DatasetItemsListResponse> {
    this.commitDatasetChangesCalls.push({ datasetId, changes });
    if (this.commitDatasetChangesError) throw this.commitDatasetChangesError;
    return this.datasetItems[datasetId] ?? { items: [] };
  }
  deleteDatasetItemCalls: { datasetId: string; itemId: string }[] = [];
  async deleteDatasetItem(datasetId: string, itemId: string): Promise<void> {
    this.deleteDatasetItemCalls.push({ datasetId, itemId });
  }

  datasetRuns: Record<string, DatasetRunsListResponse> = {};
  async listDatasetRuns(datasetId: string): Promise<DatasetRunsListResponse> {
    return this.datasetRuns[datasetId] ?? { items: [] };
  }
  runs: RunsListResponse = { items: [] };
  async listRuns(): Promise<RunsListResponse> {
    return this.runs;
  }
  // ---- acuerdo juez-humano / inter-anotador (ADR-040) ----
  judgeHumanAgreement: JudgeHumanAgreementResponse | Error = { scope: { type: "run", id: "run-1", traceTargets: 0 }, metrics: [], unmatched: { judgeOnly: [], humanOnly: [] } };
  judgeHumanCalls: Array<{ scope: AgreementScope; name?: string }> = [];
  async getJudgeHumanAgreement(scope: AgreementScope, name?: string): Promise<JudgeHumanAgreementResponse> {
    this.judgeHumanCalls.push({ scope, name });
    if (this.judgeHumanAgreement instanceof Error) throw this.judgeHumanAgreement;
    return this.judgeHumanAgreement;
  }
  interAnnotatorAgreement: InterAnnotatorAgreementResponse | Error = { scope: { type: "queue", id: "q-1" }, metrics: [] };
  async getInterAnnotatorAgreement(): Promise<InterAnnotatorAgreementResponse> {
    if (this.interAnnotatorAgreement instanceof Error) throw this.interAnnotatorAgreement;
    return this.interAnnotatorAgreement;
  }
  datasetRunDetail: DatasetRunDetailResponse | Error | null = null;
  async getDatasetRun(): Promise<DatasetRunDetailResponse> {
    if (this.datasetRunDetail instanceof Error) throw this.datasetRunDetail;
    if (!this.datasetRunDetail) throw new Error("no dataset run configured");
    return this.datasetRunDetail;
  }
}

export function queueItemDto(overrides: Partial<QueueItemDto> = {}): QueueItemDto {
  return { id: "item-1", targetType: "trace", traceId: "trace-abc", datasetRunId: null, itemIndex: null, status: "pending", population: "manual", addedAt: "2026-10-03T00:00:00.000Z", completedAt: null, ...overrides };
}

export function queueSummary(overrides: Partial<AnnotationQueueSummaryDto> = {}): AnnotationQueueSummaryDto {
  return {
    id: "q-1",
    name: "Chatbot answers",
    instructions: null,
    requiredAnnotations: 1,
    rubric: [{ configId: "cfg-1", required: true }],
    createdAt: "2026-10-03T00:00:00.000Z",
    archivedAt: null,
    progress: { pending: 3, completed: 1, skipped: 0 },
    ...overrides,
  };
}

export function scoreConfigDto(overrides: Partial<ScoreConfigDto> = {}): ScoreConfigDto {
  return { id: "cfg-1", name: "tone", dataType: "numeric", minValue: 1, maxValue: 5, categories: null, description: null, createdAt: "", updatedAt: "", archivedAt: null, ...overrides };
}

export function queueDetail(overrides: Partial<AnnotationQueueDetailResponse> = {}): AnnotationQueueDetailResponse {
  return { ...queueSummary(), configs: [scoreConfigDto()], reviewers: [], ...overrides };
}
