import type { SpanListResponse, SpanRowDto, TranscriptResponse, ConversationDetailResponse, ConversationListResponse, ConversationSummaryDto, ConversationTreeResponse, OverviewResponse, ServicesResponse, SpanNodeDto, TraceDetailResponse, TraceListResponse, TraceSummaryDto } from "@contract";
import type { ListConversationsParams, ListSpansParams, ListTracesParams, RangeParams, TraceApi } from "@/application/trace-api";
import type { ApiKeyDto, CurrentUser, ExperimentDto, IdentityApi, MembersResponseDto, OrganizationDto } from "@/application/identity-api";

/** Puerto de identidad (ADR-013): usada solo por OnboardingGuide en estas pruebas de UI, sin sesión real. */
export class FakeIdentityApi implements IdentityApi {
  async getMe(): Promise<CurrentUser | null> {
    return null;
  }
  async listOrganizations(): Promise<OrganizationDto[]> {
    return [];
  }
  async createOrganization(name: string): Promise<OrganizationDto> {
    return { id: "org-1", name, myRole: "org_admin" };
  }
  async addOrgAdmin(): Promise<void> {}
  async listOrgMembers(): Promise<MembersResponseDto> {
    return { members: [], pendingInvitations: [] };
  }
  async listExperiments(): Promise<ExperimentDto[]> {
    return [];
  }
  async createExperiment(organizationId: string, name: string, serviceName: string): Promise<ExperimentDto> {
    return { id: "exp-1", organizationId, name, serviceName, myRole: "org_admin" };
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
    truncated: false,
    conversationId: null,
    framework: null,
    roots: [node()],
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
  async listServices(_p: RangeParams): Promise<ServicesResponse> {
    return { items: this.services };
  }
}
