import type { ConversationListQuery, SpanListQuery, TraceListQuery, TraceRepository, TraceSpans } from "@/application/ports/trace-repository";
import type { ConversationCursor, ConversationSummary } from "@/domain/conversation";
import type { ChatSpanRecord } from "@/domain/transcript";
import type { MetricsOverview, MetricsQuery, ServiceUsage } from "@/domain/metrics";
import type { Span } from "@/domain/span";
import type { SpanCursor, SpanRecord } from "@/domain/span-row";
import type { TimeRange } from "@/domain/time-range";
import type { Page, TraceSummary } from "@/domain/trace";

let counter = 0;

export function span(overrides: Partial<Span> = {}): Span {
  counter += 1;
  return {
    spanId: `s${String(counter).padStart(4, "0")}`,
    parentSpanId: null,
    name: "step",
    serviceName: "svc",
    scopeName: "memtrace",
    startTimeUs: 1_000_000 + counter,
    durationMs: 10,
    status: { code: "ok", message: null },
    attributes: {},
    events: [],
    ...overrides,
  };
}

export const emptyOverview: MetricsOverview = {
  bucketSeconds: 60,
  totals: { traces: 0, spans: 0, conversations: 0, errorTraces: 0, errorRate: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  latencyMs: { p50: 0, p95: 0, p99: 0 },
  timeseries: [],
  byModel: [],
  byTool: [],
  byTopic: [],
};

/** Repositorio en memoria: prueba servicio y HTTP sin ClickHouse. */
export class FakeTraceRepository implements TraceRepository {
  lastListQuery?: TraceListQuery;
  lastOverviewQuery?: MetricsQuery;
  lastConversationQuery?: ConversationListQuery;
  lastConversationRange?: TimeRange;
  lastSpanQuery?: SpanListQuery;
  spanPage: Page<SpanRecord, SpanCursor> = { items: [], nextCursor: null };
  conversationPage: Page<ConversationSummary, ConversationCursor> = { items: [], nextCursor: null };
  conversations = new Map<string, ConversationSummary>();
  chatRecords: ChatSpanRecord[] = [];
  chatTruncated = false;
  page: Page<TraceSummary> = { items: [], nextCursor: null };
  traces = new Map<string, TraceSpans>();
  overview: MetricsOverview = emptyOverview;
  services: string[] = [];
  usageByService: ServiceUsage[] = [];
  failWith?: Error;

  private check() {
    if (this.failWith) throw this.failWith;
  }
  async listTraces(query: TraceListQuery) {
    this.check();
    this.lastListQuery = query;
    return this.page;
  }
  async getTraceSpans(traceId: string) {
    this.check();
    return this.traces.get(traceId) ?? null;
  }
  async getTraceSpansForTraces(traceIds: string[]) {
    this.check();
    const result = new Map<string, TraceSpans>();
    for (const id of traceIds) {
      const found = this.traces.get(id);
      if (found) result.set(id, found);
    }
    return result;
  }
  async getOverview(query: MetricsQuery) {
    this.check();
    this.lastOverviewQuery = query;
    return this.overview;
  }
  async listServices(_range: TimeRange) {
    this.check();
    return this.services;
  }
  async getUsageByServices(_serviceNames: string[], _range: TimeRange) {
    this.check();
    return this.usageByService;
  }
  async listConversations(query: ConversationListQuery) {
    this.check();
    this.lastConversationQuery = query;
    return this.conversationPage;
  }
  async getConversation(conversationId: string, range: TimeRange) {
    this.check();
    this.lastConversationRange = range;
    return this.conversations.get(conversationId) ?? null;
  }
  async listSpans(query: SpanListQuery) {
    this.check();
    this.lastSpanQuery = query;
    return this.spanPage;
  }
  async getConversationMessages() {
    this.check();
    return { records: this.chatRecords, truncated: this.chatTruncated };
  }
  async ping() {
    this.check();
  }
}
