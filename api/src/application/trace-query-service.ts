import type { ConversationCursor, ConversationSummary } from "@/domain/conversation";
import { ConversationNotFoundError, TraceNotFoundError, ValidationError } from "@/domain/errors";
import { chooseBucketSeconds, fillTimeseries, type MetricsOverview } from "@/domain/metrics";
import { MAX_RANGE_MS, resolveTimeRange } from "@/domain/time-range";
import type { Page, PageCursor, TraceDetail, TraceSummary } from "@/domain/trace";
import { buildTraceDetail } from "@/domain/tree";
import type { TraceRepository } from "./ports/trace-repository";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const MAX_SPANS_PER_TRACE = 5000;

export interface ListTracesInput {
  from?: Date;
  to?: Date;
  service?: string;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  conversationId?: string;
  limit?: number;
  cursor?: PageCursor;
}

export interface ListConversationsInput {
  from?: Date;
  to?: Date;
  service?: string;
  hasErrors?: boolean;
  limit?: number;
  cursor?: ConversationCursor;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  turns: Page<TraceSummary>;
}

/** Casos de uso de consulta. Los adapters de entrada solo hablan con esta clase. */
export class TraceQueryService {
  constructor(
    private readonly repository: TraceRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private pageSize(value: number | undefined): number {
    const limit = value ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ValidationError("Invalid limit", { limit: `must be an integer between 1 and ${MAX_PAGE_SIZE}` });
    }
    return limit;
  }

  listConversations(input: ListConversationsInput): Promise<Page<ConversationSummary, ConversationCursor>> {
    return this.repository.listConversations({
      ...resolveTimeRange(input, this.now()),
      service: input.service,
      hasErrors: input.hasErrors,
      limit: this.pageSize(input.limit),
      cursor: input.cursor,
    });
  }

  /** Resumen de la conversación + sus turnos en orden cronológico (paginados). */
  async getConversation(conversationId: string, input: { limit?: number; cursor?: PageCursor } = {}): Promise<ConversationDetail> {
    const limit = this.pageSize(input.limit);
    const toMs = this.now();
    const range = { fromMs: toMs - MAX_RANGE_MS, toMs };
    const [conversation, turns] = await Promise.all([
      this.repository.getConversation(conversationId, range),
      this.repository.listTraces({ ...range, conversationId, order: "asc", limit, cursor: input.cursor }),
    ]);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return { conversation, turns };
  }

  listTraces(input: ListTracesInput): Promise<Page<TraceSummary>> {
    const limit = this.pageSize(input.limit);
    const range = resolveTimeRange(input, this.now());
    return this.repository.listTraces({
      ...range,
      service: input.service,
      status: input.status,
      hasErrors: input.hasErrors,
      minDurationMs: input.minDurationMs,
      conversationId: input.conversationId,
      limit,
      cursor: input.cursor,
    });
  }

  async getTrace(traceId: string): Promise<TraceDetail> {
    const found = await this.repository.getTraceSpans(traceId, MAX_SPANS_PER_TRACE);
    if (!found || found.spans.length === 0) throw new TraceNotFoundError(traceId);
    return buildTraceDetail(traceId, found.spans, found.truncated);
  }

  async getOverview(input: { from?: Date; to?: Date; service?: string }): Promise<MetricsOverview & { fromMs: number; toMs: number }> {
    const { fromMs, toMs } = resolveTimeRange(input, this.now());
    const bucketSeconds = chooseBucketSeconds(fromMs, toMs);
    const overview = await this.repository.getOverview({ fromMs, toMs, service: input.service, bucketSeconds });
    return {
      ...overview,
      bucketSeconds, // el servicio es la autoridad: la serie rellena y el valor anunciado deben coincidir
      timeseries: fillTimeseries(overview.timeseries, fromMs, toMs, bucketSeconds),
      fromMs,
      toMs,
    };
  }

  listServices(input: { from?: Date; to?: Date }): Promise<string[]> {
    return this.repository.listServices(resolveTimeRange(input, this.now()));
  }

  ping(): Promise<void> {
    return this.repository.ping();
  }
}
