import { permissionsOf } from "./permissions";
import type { AlertEventsPageDto, AlertRuleDto, AlertsOverviewDto, AuditPageDto, BudgetViewDto, ChartCatalogEntryDto, OpenAlertsDto, PartnerClientDto, PartnerGrantDto, PartnershipDto, RetentionPolicyDto } from "@contract";
import type {
  AddQueueItemsResponse,
  InterAnnotatorAgreementResponse,
  JudgeHumanAgreementResponse,
  AnnotationQueueDetailResponse,
  AnnotationQueueDto,
  AnnotationQueueListItemDto,
  AnnotationQueueSummaryDto,
  AnnotationQueuesListResponse,
  ReviewerCandidatesResponse,
  LowRatedResponse,
  ErrorOverviewResponse,
  FeedbackOverviewResponse,
  FeedbackRatingsResponse,
  TraceFeedbackResponse,
  AnnotationRatingsResponse,
  NextQueueItemResponse,
  QueueItemDto,
  QueueItemsResponse,
  QueueResolutionDto,
  QueueResultItemDto,
  QueueResultsResponse,
  TraceQueuesResponse,
  ResolveQueueItemBody,
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
  PromoteTracesBody,
  PromoteTracesResponse,
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
  RevisionsResponse,
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
import {
  type AlertRuleBody,
  type BudgetBody,
  EMPTY_THEME,
  type ApiKeyDto,
  type CurrentUser,
  type ExperimentDto,
  type ExternalMappingDto,
  type IdentityApi,
  type MembersResponseDto,
  type MetricReportDto,
  type NewScoreConfigInput,
  type ScoreConfigPatchInput,
  type MetricReportSummaryDto,
  type OrganizationDto,
  type OrganizationIdentityDto,
  type ScimTokenDto,
  type OrganizationThemeDto,
  type SavedCustomMetricDto,
} from "@/application/identity-api";

const NO_THEME: OrganizationThemeDto = EMPTY_THEME;

/** Puerto de identidad (ADR-013): usada solo por OnboardingGuide en estas pruebas de UI, sin sesión real. */
export class FakeIdentityApi implements IdentityApi {
  async getMe(): Promise<CurrentUser | null> {
    return null;
  }
  async listOrganizations(): Promise<OrganizationDto[]> {
    return [];
  }
  async createOrganization(name: string): Promise<OrganizationDto> {
    return { id: "org-1", name, myRole: "org_admin", permissions: permissionsOf("org_admin"), theme: NO_THEME };
  }
  async addOrgAdmin(): Promise<void> {}
  async listOrgMembers(): Promise<MembersResponseDto> {
    return { members: [], pendingInvitations: [] };
  }
  async updateOrganizationTheme(organizationId: string, theme: OrganizationThemeDto): Promise<OrganizationDto> {
    return { id: organizationId, name: "org", myRole: "org_admin", permissions: permissionsOf("org_admin"), theme };
  }
  alerts: AlertsOverviewDto = { rules: [], events: [], budget: null };
  alertCalls: Array<{ op: string; id?: string; body?: unknown }> = [];
  /** si se pone, crear o cambiar una regla / el presupuesto falla con este error (p. ej. un 400 con campos) */
  alertError: Error | null = null;
  openAlerts: OpenAlertsDto = { items: [] };
  olderEvents: AlertEventsPageDto = { items: [], nextCursor: null };
  async getAlerts(): Promise<AlertsOverviewDto> {
    return this.alerts;
  }
  async createAlertRule(_experimentId: string, body: AlertRuleBody): Promise<AlertRuleDto> {
    this.alertCalls.push({ op: "create", body });
    if (this.alertError) throw this.alertError;
    const rule: AlertRuleDto = { ...body, id: `rule-${this.alerts.rules.length + 1}`, experimentId: "exp-1", createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z" };
    this.alerts = { ...this.alerts, rules: [...this.alerts.rules, { rule, status: null }] };
    return rule;
  }
  async updateAlertRule(_experimentId: string, ruleId: string, body: AlertRuleBody): Promise<AlertRuleDto> {
    this.alertCalls.push({ op: "update", id: ruleId, body });
    if (this.alertError) throw this.alertError;
    const current = this.alerts.rules.find((r) => r.rule.id === ruleId)!.rule;
    const rule = { ...current, ...body };
    this.alerts = { ...this.alerts, rules: this.alerts.rules.map((r) => (r.rule.id === ruleId ? { rule, status: null } : r)) };
    return rule;
  }
  async deleteAlertRule(_experimentId: string, ruleId: string): Promise<void> {
    this.alertCalls.push({ op: "delete", id: ruleId });
    this.alerts = { ...this.alerts, rules: this.alerts.rules.filter((r) => r.rule.id !== ruleId) };
  }
  async listAlertEvents(_experimentId: string, cursor?: string): Promise<AlertEventsPageDto> {
    this.alertCalls.push({ op: "events", id: cursor });
    return this.olderEvents;
  }
  async setBudget(_experimentId: string, body: BudgetBody): Promise<BudgetViewDto> {
    this.alertCalls.push({ op: "setBudget", body });
    if (this.alertError) throw this.alertError;
    const view: BudgetViewDto = { budget: { experimentId: "exp-1", ...body, updatedAt: "2026-10-10T00:00:00.000Z" }, month: "2026-10-01", spentUsd: 0, percent: 0, projectedUsd: null };
    this.alerts = { ...this.alerts, budget: view };
    return view;
  }
  async deleteBudget(): Promise<void> {
    this.alertCalls.push({ op: "deleteBudget" });
    this.alerts = { ...this.alerts, budget: null };
  }
  async listOpenAlerts(): Promise<OpenAlertsDto> {
    return this.openAlerts;
  }
  retention: RetentionPolicyDto = { organizationId: "org-1", defaultDays: 30, minDays: 1, maxDays: 365, experiments: [] };
  retentionCalls: Array<{ scope: "organization" | "experiment"; id: string; days: number | null }> = [];
  async getRetention(): Promise<RetentionPolicyDto> {
    return this.retention;
  }
  async setOrganizationRetention(_organizationId: string, days: number): Promise<RetentionPolicyDto> {
    this.retentionCalls.push({ scope: "organization", id: _organizationId, days });
    this.retention = {
      ...this.retention,
      defaultDays: days,
      experiments: this.retention.experiments.map((e) => ({ ...e, overrideDays: e.overrideDays !== null && e.overrideDays > days ? null : e.overrideDays, effectiveDays: Math.min(days, e.overrideDays ?? days) })),
    };
    return this.retention;
  }
  async setExperimentRetention(_organizationId: string, experimentId: string, days: number | null): Promise<RetentionPolicyDto> {
    this.retentionCalls.push({ scope: "experiment", id: experimentId, days });
    this.retention = {
      ...this.retention,
      experiments: this.retention.experiments.map((e) => (e.experimentId === experimentId ? { ...e, overrideDays: days, effectiveDays: days ?? this.retention.defaultDays } : e)),
    };
    return this.retention;
  }
  auditPage: AuditPageDto = { items: [], nextCursor: null };
  auditRequests: Array<Record<string, unknown>> = [];
  async listAuditLog(_organizationId: string, filter: Record<string, unknown>): Promise<AuditPageDto> {
    this.auditRequests.push(filter);
    return this.auditPage;
  }
  partnerships: PartnershipDto[] = [];
  partnerClients: PartnerClientDto[] = [];
  partnerCalls: Array<{ call: string; args: unknown[] }> = [];
  async listPartnerships(): Promise<PartnershipDto[]> {
    return this.partnerships;
  }
  async createPartnership(_org: string, partnerOrganizationId: string): Promise<PartnershipDto> {
    this.partnerCalls.push({ call: "createPartnership", args: [partnerOrganizationId] });
    const created = { id: "p-new", partnerOrganizationId, partnerOrganizationName: "New partner", createdAt: "2026-10-10T00:00:00Z", grants: [] };
    this.partnerships = [...this.partnerships, created];
    return created;
  }
  async revokePartnership(_org: string, partnershipId: string): Promise<void> {
    this.partnerCalls.push({ call: "revokePartnership", args: [partnershipId] });
    this.partnerships = this.partnerships.filter((p) => p.id !== partnershipId);
  }
  async grantPartnerAccess(_org: string, partnershipId: string, input: { email: string; role: string; experimentId: string | null }): Promise<PartnerGrantDto> {
    this.partnerCalls.push({ call: "grantPartnerAccess", args: [partnershipId, input] });
    const grant = { id: "g-new", partnershipId, userId: "u-x", userEmail: input.email, userName: null, role: input.role, experimentId: input.experimentId, createdAt: "2026-10-10T00:00:00Z" };
    this.partnerships = this.partnerships.map((p) => (p.id === partnershipId ? { ...p, grants: [...p.grants, grant] } : p));
    return grant;
  }
  async revokePartnerGrant(_org: string, partnershipId: string, grantId: string): Promise<void> {
    this.partnerCalls.push({ call: "revokePartnerGrant", args: [partnershipId, grantId] });
    this.partnerships = this.partnerships.map((p) => (p.id === partnershipId ? { ...p, grants: p.grants.filter((g) => g.id !== grantId) } : p));
  }
  async listPartnerClients(): Promise<PartnerClientDto[]> {
    return this.partnerClients;
  }
  exportPreview: { rows: number; maxRows: number } | Error = { rows: 12, maxRows: 2_000_000 };
  async previewExport(): Promise<{ rows: number; maxRows: number }> {
    if (this.exportPreview instanceof Error) throw this.exportPreview;
    return this.exportPreview;
  }
  exportUrl(experimentId: string, request: { kind: string; from: string; to: string }): string {
    return `/api/v1/experiments/${experimentId}/export?kind=${request.kind}&from=${request.from}&to=${request.to}`;
  }
  identity: OrganizationIdentityDto = { groupsClaim: "groups", mappings: [], scimTokens: [], scimBaseUrl: "https://mt.test/api/scim/v2" };
  async getOrganizationIdentity(): Promise<OrganizationIdentityDto> {
    return this.identity;
  }
  async setGroupsClaim(_organizationId: string, groupsClaim: string): Promise<void> {
    this.identity = { ...this.identity, groupsClaim };
  }
  async createExternalMapping(_organizationId: string, input: { externalGroup: string; experimentId: string | null; role: string }): Promise<ExternalMappingDto> {
    const mapping = { id: `m${this.identity.mappings.length + 1}`, createdAt: "2026-10-05T00:00:00.000Z", ...input };
    this.identity = { ...this.identity, mappings: [...this.identity.mappings, mapping] };
    return mapping;
  }
  async deleteExternalMapping(_organizationId: string, mappingId: string): Promise<void> {
    this.identity = { ...this.identity, mappings: this.identity.mappings.filter((m) => m.id !== mappingId) };
  }
  async createScimToken(): Promise<ScimTokenDto & { plaintext: string }> {
    const token = { id: `t${this.identity.scimTokens.length + 1}`, tokenPrefix: "mtscim_abcde", createdAt: "2026-10-05T00:00:00.000Z", lastUsedAt: null };
    this.identity = { ...this.identity, scimTokens: [...this.identity.scimTokens, token] };
    return { ...token, plaintext: "mtscim_abcde-secret" };
  }
  async revokeScimToken(_organizationId: string, tokenId: string): Promise<void> {
    this.identity = { ...this.identity, scimTokens: this.identity.scimTokens.filter((t) => t.id !== tokenId) };
  }
  async listExperiments(): Promise<ExperimentDto[]> {
    return [];
  }
  createdExperiments: Array<{ organizationId: string; name: string; serviceName: string; profile: { description?: string } }> = [];
  async createExperiment(organizationId: string, name: string, serviceName: string, profile: { description?: string } = {}): Promise<ExperimentDto> {
    this.createdExperiments.push({ organizationId, name, serviceName, profile });
    return { id: "exp-1", organizationId, name, serviceName, myRole: "org_admin", permissions: permissionsOf("org_admin"), organizationTheme: NO_THEME };
  }
  async addExperimentMember(): Promise<void> {}
  experimentMembers: MembersResponseDto["members"] = [];
  async listExperimentMembers(): Promise<MembersResponseDto> {
    return { members: this.experimentMembers, pendingInvitations: [] };
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
  /** Ediciones del catálogo de las Custom charts (ADR-078), como las guarda la API. */
  chartCatalog: ChartCatalogEntryDto[] = [];
  catalogCalls: Array<{ method: string; args: unknown[] }> = [];
  catalogError: Error | null = null;
  async listChartCatalog(): Promise<ChartCatalogEntryDto[]> {
    return this.chartCatalog;
  }
  async saveChartCatalogEntry(experimentId: string, entry: { kind: "step" | "attribute"; key: string; displayName: string | null; visibility?: "auto" | "shown" | "hidden" }): Promise<ChartCatalogEntryDto | null> {
    this.catalogCalls.push({ method: "save", args: [experimentId, entry] });
    if (this.catalogError) throw this.catalogError;
    const rest = this.chartCatalog.filter((e) => !(e.kind === entry.kind && e.key === entry.key));
    const visibility = entry.visibility ?? "auto";
    if (entry.displayName === null && visibility === "auto") {
      this.chartCatalog = rest;
      return null;
    }
    const saved: ChartCatalogEntryDto = { kind: entry.kind, key: entry.key, displayName: entry.displayName, visibility, updatedAt: "2026-10-09T10:00:00.000Z" };
    this.chartCatalog = [...rest, saved];
    return saved;
  }
  async deleteChartCatalogEntry(experimentId: string, kind: "step" | "attribute", key: string): Promise<void> {
    this.catalogCalls.push({ method: "delete", args: [experimentId, kind, key] });
    this.chartCatalog = this.chartCatalog.filter((e) => !(e.kind === kind && e.key === key));
  }
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
      targetPassRate: input.targetPassRate ?? null,
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
    error: null,
    conversationId: null, revision: null, prompts: [],
    ...overrides,
  };
}

export function conversation(overrides: Partial<ConversationSummaryDto> = {}): ConversationSummaryDto {
  return {
    conversationId: "conv-1",
    prompts: [],
    serviceNames: ["svc"],
    startTime: "2026-09-26T12:00:00.000Z",
    lastActivity: "2026-09-26T12:05:00.000Z",
    turnCount: 2,
    errorTurns: 0,
    failedSpans: 0,
    totalTokens: 0,
    activeMs: 100,
    title: null,
    costUsd: null,
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
    conversationId: null, revision: null,
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
  return { id: "run-1", name: "toy-agent-v1", versionMajor: 1, versionMinor: 0, itemCount: 3, status: "completed", createdAt: "2026-09-30T22:45:54Z", revision: null, revisionDirty: null, aggregates: [scoreAggregate()], ...overrides };
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
    telemetry: null,
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
  queues: AnnotationQueueListItemDto[] = [];
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
  lowRated: LowRatedResponse = { count: 0, items: [] };
  ratings: AnnotationRatingsResponse["items"] = [];
  async getAnnotationRatings(): Promise<AnnotationRatingsResponse> {
    return { items: this.ratings };
  }
  feedback: TraceFeedbackResponse = { votes: [], alignment: "unknown" };
  feedbackRatings: FeedbackRatingsResponse["items"] = [];
  feedbackOverview: FeedbackOverviewResponse = { summary: { total: 0, up: 0, down: 0, satisfaction: null, ratedTraces: 0 }, days: [], alignment: { aligned: 0, misaligned: 0 }, recentDown: [] };
  async getTraceFeedback(): Promise<TraceFeedbackResponse> {
    return this.feedback;
  }
  async getFeedbackRatings(): Promise<FeedbackRatingsResponse> {
    return { items: this.feedbackRatings };
  }
  errorOverview: ErrorOverviewResponse = { range: { from: "", to: "" }, previousRange: null, totals: { occurrences: 0, tracesWithErrors: 0, conversationsWithErrors: 0, totalTraces: 0, totalConversations: 0 }, categories: [] };
  async getErrorOverview(): Promise<ErrorOverviewResponse> {
    return this.errorOverview;
  }
  async getFeedbackOverview(): Promise<FeedbackOverviewResponse> {
    return this.feedbackOverview;
  }
  async getLowRated(): Promise<LowRatedResponse> {
    return this.lowRated;
  }
  async listAnnotationQueues(): Promise<AnnotationQueuesListResponse> {
    return { items: this.queues };
  }
  async createAnnotationQueue(body: NewAnnotationQueueBody): Promise<AnnotationQueueDto> {
    this.createdQueues.push(body);
    return { id: "q-new", name: body.name, instructions: body.instructions ?? null, requiredAnnotations: body.requiredAnnotations, reviewerIds: body.reviewerIds, rubric: body.rubric, createdAt: "2026-10-03T00:00:00.000Z", archivedAt: null };
  }
  reviewerCandidates: ReviewerCandidatesResponse["candidates"] = [];
  async listReviewerCandidates(): Promise<ReviewerCandidatesResponse> {
    return { candidates: this.reviewerCandidates };
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

  traceQueues: TraceQueuesResponse = { items: [] };
  async listTraceQueues(): Promise<TraceQueuesResponse> {
    return this.traceQueues;
  }
  queueResults: QueueResultsResponse = { configs: [], total: 0, items: [] };
  resolutions: Array<{ queueId: string; itemId: string; configId: string; body: ResolveQueueItemBody }> = [];
  clearedResolutions: Array<{ itemId: string; configId: string }> = [];
  async getQueueResults(): Promise<QueueResultsResponse> {
    return this.queueResults;
  }
  async resolveQueueItem(queueId: string, itemId: string, configId: string, body: ResolveQueueItemBody): Promise<QueueResolutionDto> {
    this.resolutions.push({ queueId, itemId, configId, body });
    return { value: String(body.value), expectedOutput: body.expectedOutput ?? null, resolvedBy: "u-1", resolvedAt: "2026-10-04T00:00:00.000Z" };
  }
  async clearQueueResolution(_queueId: string, itemId: string, configId: string): Promise<void> {
    this.clearedResolutions.push({ itemId, configId });
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
  revisions: RevisionsResponse = { items: [] };
  async listRevisions(_p: RangeParams): Promise<RevisionsResponse> {
    return this.revisions;
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
  promoteCalls: { datasetId: string; body: PromoteTracesBody }[] = [];
  promoteResult: PromoteTracesResponse = { added: [], skipped: [], version: null };
  async promoteTracesToDataset(datasetId: string, body: PromoteTracesBody): Promise<PromoteTracesResponse> {
    this.promoteCalls.push({ datasetId, body });
    return this.promoteResult;
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

export function queueResultItem(overrides: Partial<QueueResultItemDto> = {}): QueueResultItemDto {
  return { ...queueItemDto({ status: "completed" }), criteria: [], needsResolution: false, promotedTo: [], ...overrides };
}

export function queueSummary(overrides: Partial<AnnotationQueueListItemDto> = {}): AnnotationQueueListItemDto {
  return {
    id: "q-1",
    name: "Chatbot answers",
    instructions: null,
    requiredAnnotations: 1,
    reviewerIds: ["u-1"],
    rubric: [{ configId: "cfg-1", required: true }],
    createdAt: "2026-10-03T00:00:00.000Z",
    archivedAt: null,
    progress: { pending: 3, completed: 1, skipped: 0 },
    toCurate: 0,
    assignedReviewers: [{ userId: "u-1", name: "Ana García", image: null }],
    isReviewer: true,
    ...overrides,
  };
}

export function scoreConfigDto(overrides: Partial<ScoreConfigDto> = {}): ScoreConfigDto {
  return { id: "cfg-1", name: "tone", dataType: "numeric", minValue: 1, maxValue: 5, categories: null, targetPassRate: null, description: null, createdAt: "", updatedAt: "", archivedAt: null, ...overrides };
}

export function queueDetail(overrides: Partial<AnnotationQueueDetailResponse> = {}): AnnotationQueueDetailResponse {
  return { ...queueSummary(), configs: [scoreConfigDto()], reviewers: [], ...overrides };
}

// ── Registro de asistentes (ADR-053) ───────────────────────────────────────────────────────────────────────────
import type { AssistantApi } from "@/application/assistant-api";
import type { AccessGrantDto, AssistantPersonDto, AssistantCardDto, ConnectionDto, DeployPreviewDto, DeployRunDto, DeploymentSummaryDto, HealthCheckDto, HealthStatusDto } from "@contract";

export function deploymentDto(key: string, status: HealthStatusDto, overrides: Partial<DeploymentSummaryDto> = {}): DeploymentSummaryDto {
  const isProduction = key === "pro";
  return {
    id: `dep-${key}`, experimentId: "exp-1", environmentId: `env-${key}`, apiUrl: `https://${key}.acme.test/weather`, healthUrl: null, version: "v1.0.0", deployRef: null,
    authMethod: "oauth2", authProvider: "Entra ID", authAudience: null, healthCheckEnabled: true, healthIntervalSeconds: null, healthStatus: status,
    healthCheckedAt: "2026-10-05T11:59:30.000Z", healthStatusSince: "2026-10-05T10:00:00.000Z", healthLatencyMs: 112, healthConsecutiveFailures: 0,
    environment: { id: `env-${key}`, key, label: key.toUpperCase(), position: ["dev", "pre", "pro"].indexOf(key), isProduction, healthIntervalSeconds: 60 },
    access: { everyone: false, groups: 2, users: 1 },
    recent: { buckets: Array.from({ length: 36 }, (_, i) => (i % 9 === 0 ? null : status === "down" && i > 32 ? "down" : "up")) as DeploymentSummaryDto["recent"]["buckets"], uptimePercent: status === "down" ? 91.7 : 100 },
    ...overrides,
  };
}

export function assistantCard(overrides: Partial<AssistantCardDto> = {}): AssistantCardDto {
  const deployments = overrides.deployments ?? [deploymentDto("dev", "up"), deploymentDto("pro", "up")];
  return {
    experimentId: "exp-1", name: "weather-assistant", serviceName: "weather-assistant", description: "Answers forecast questions", owner: { id: "u1", name: "Marta F.", email: "m@acme.test", image: null },
    lifecycle: "active", chat: null, repo: null, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z",
    connectionCounts: { mcpServers: 2, tools: 7, agents: 1, toReview: 0 }, mcpServerNames: ["weather-mcp", "geocoding-mcp"], members: { total: 2, preview: [{ userId: "u1", name: "Marta Fernández", email: "m@acme.test", image: "https://photos.example/marta.png", role: "technical" }, { userId: "u2", name: null, email: "luis@acme.test", image: null, role: "business" }] }, status: "up", ...overrides, deployments,
  };
}

export function connectionDto(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: "c1", kind: "tool", name: "get_forecast", via: "weather-mcp", peerExperimentId: null, declared: true, status: "approved",
    firstSeenAt: "2026-10-01T00:00:00.000Z", lastSeenAt: "2026-10-05T11:59:00.000Z", decidedBy: null, decidedAt: null, note: null, usage: { calls: 120, errors: 3 }, ...overrides,
  };
}

/** Puerto de asistentes en memoria: guarda las llamadas de escritura para que las pruebas las comprueben. */
export class FakeAssistantApi implements AssistantApi {
  calls: Array<{ method: string; args: unknown[] }> = [];
  catalog: AssistantCardDto[] = [];
  card: AssistantCardDto = assistantCard();
  connections: ConnectionDto[] = [];
  grants: AccessGrantDto[] = [];
  history: HealthCheckDto[] = [];
  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }
  async listCatalog() { return this.catalog; }
  async getAssistant() { return this.card; }
  async updateAssistant(experimentId: string, patch: unknown) { this.record("updateAssistant", experimentId, patch); return this.card; }
  async listEnvironments() { return [{ id: "env-pre", key: "pre", label: "PRE", position: 1, isProduction: false, healthIntervalSeconds: 300 }]; }
  async createDeployment(experimentId: string, key: string, input: unknown) { this.record("createDeployment", experimentId, key, input); return deploymentDto(key, "unknown"); }
  async updateDeployment(experimentId: string, id: string, patch: unknown) { this.record("updateDeployment", experimentId, id, patch); return deploymentDto("pro", "up"); }
  async deleteDeployment(experimentId: string, id: string) { this.record("deleteDeployment", experimentId, id); }
  chatReply: string | Error = "Sunny, 21 °C";
  async chat(experimentId: string, deploymentId: string, message: string, sessionId: string | null) {
    this.record("chat", experimentId, deploymentId, message, sessionId);
    if (this.chatReply instanceof Error) throw this.chatReply;
    return { reply: this.chatReply, sessionId: "s-1", traceId: this.chatTraceId, latencyMs: 30 };
  }
  chatTraceId: string | null = null;
  async sendFeedback(experimentId: string, traceId: string, rating: 1 | -1) { this.record("sendFeedback", experimentId, traceId, rating); }
  preview: DeployPreviewDto | Error = { ref: "main", sha: "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901", environment: "pro", gate: { allowed: true, verdict: "allowed", sha: "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901", requiredRuns: 1, reason: "The evaluation of this commit passes.", runs: [] } };
  deploys: DeployRunDto[] = [];
  async previewDeploy(experimentId: string, id: string) { this.record("previewDeploy", experimentId, id); if (this.preview instanceof Error) throw this.preview; return this.preview; }
  async deploy(experimentId: string, id: string, bypassReason: string | null): Promise<DeployRunDto> {
    this.record("deploy", experimentId, id, bypassReason);
    return { id: "dr-1", deploymentId: id, commitSha: "3a08213f9b1c2d4e5f60718293a4b5c6d7e8f901", ref: "main", requestedBy: "u1", status: "running", gateVerdict: "allowed", gateBypassed: bypassReason !== null, bypassReason, providerRunUrl: null, error: null, createdAt: "2026-10-07T10:00:00Z", finishedAt: null };
  }
  async listDeploys() { return this.deploys; }
  async checkDeploymentNow(experimentId: string, id: string) { this.record("checkDeploymentNow", experimentId, id); return deploymentDto("pro", "up"); }
  async getHealthHistory() { return this.history; }
  async listGrants() { return this.grants; }
  async addGrant(experimentId: string, deploymentId: string, input: unknown) { this.record("addGrant", experimentId, deploymentId, input); return { id: "g-new", deploymentId, subjectType: "everyone" as const, userId: null, user: null, externalGroup: null, memberCount: null, source: "manual" as const, syncedAt: null }; }
  people: AssistantPersonDto[] = [];
  async searchPeople(experimentId: string, query: string) { this.record("searchPeople", experimentId, query); return this.people; }
  async removeGrant(experimentId: string, deploymentId: string, grantId: string) { this.record("removeGrant", experimentId, deploymentId, grantId); }
  async listConnections() { return this.connections; }
  async declareConnection(experimentId: string, input: unknown) { this.record("declareConnection", experimentId, input); return connectionDto(); }
  async decideConnection(experimentId: string, id: string, status: string, note: string | null) { this.record("decideConnection", experimentId, id, status, note); return connectionDto({ id, status: status as ConnectionDto["status"] }); }
  async undeclareConnection(experimentId: string, id: string) { this.record("undeclareConnection", experimentId, id); }
  async syncConnections(experimentId: string) { this.record("syncConnections", experimentId); return { observed: 2 }; }
}
