import type { ConversationCursor, ConversationSummary } from "@/domain/conversation";
import type { MetricsOverview } from "@/domain/metrics";
import type { SpanCursor, SpanRow } from "@/domain/span-row";
import type { Transcript } from "@/domain/transcript";
import type { SpanNode } from "@/domain/span";
import type { Page, TraceDetail, TraceSummary } from "@/domain/trace";
import type { TranscriptResponse, ConversationDetailResponse, ConversationListResponse, ConversationSummaryDto, OverviewResponse, SpanListResponse, SpanNodeDto, TraceDetailResponse, TraceListResponse, TraceSummaryDto } from "./contract";
import { encodeConversationCursor, encodeCursor, encodeSpanCursor } from "./schemas";

const isoFromUs = (us: number) => new Date(Math.round(us / 1000)).toISOString();
const isoFromMs = (ms: number) => new Date(ms).toISOString();

export function toTraceSummaryDto(t: TraceSummary): TraceSummaryDto {
  return {
    traceId: t.traceId,
    rootSpanName: t.rootSpanName,
    serviceName: t.serviceName,
    startTime: isoFromUs(t.startTimeUs),
    durationMs: t.durationMs,
    status: t.status,
    spanCount: t.spanCount,
    errorCount: t.errorCount,
    totalTokens: t.totalTokens,
    conversationId: t.conversationId,
  };
}

export function toConversationSummaryDto(c: ConversationSummary): ConversationSummaryDto {
  return {
    conversationId: c.conversationId,
    serviceNames: c.serviceNames,
    startTime: isoFromUs(c.startTimeUs),
    lastActivity: isoFromUs(c.lastActivityUs),
    turnCount: c.turnCount,
    errorTurns: c.errorTurns,
    failedSpans: c.failedSpans,
    totalTokens: c.totalTokens,
    activeMs: c.activeMs,
  };
}

export function toConversationListResponse(page: Page<ConversationSummary, ConversationCursor>): ConversationListResponse {
  return {
    items: page.items.map(toConversationSummaryDto),
    nextCursor: page.nextCursor ? encodeConversationCursor(page.nextCursor) : null,
  };
}

export function toConversationDetailResponse(conversation: ConversationSummary, turns: Page<TraceSummary>): ConversationDetailResponse {
  return { ...toConversationSummaryDto(conversation), turns: toTraceListResponse(turns) };
}

export function toSpanListResponse(page: Page<SpanRow, SpanCursor>): SpanListResponse {
  return {
    items: page.items.map(({ startTimeUs, ...row }) => ({ ...row, startTime: isoFromUs(startTimeUs) })),
    nextCursor: page.nextCursor ? encodeSpanCursor(page.nextCursor) : null,
  };
}

export function toTranscriptResponse(t: Transcript): TranscriptResponse {
  return {
    conversationId: t.conversationId,
    contentCaptured: t.contentCaptured,
    truncated: t.truncated,
    turns: t.turns.map(({ startTimeUs, ...turn }) => ({ ...turn, startTime: isoFromUs(startTimeUs) })),
  };
}

export function toTraceListResponse(page: Page<TraceSummary>): TraceListResponse {
  return { items: page.items.map(toTraceSummaryDto), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
}

/** Iterativo (post-orden): una traza muy profunda no debe desbordar la pila. */
function toSpanNodeDtos(roots: SpanNode[]): SpanNodeDto[] {
  const dtos = new Map<SpanNode, SpanNodeDto>();
  const order: SpanNode[] = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop()!;
    order.push(node);
    stack.push(...node.children);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]!;
    dtos.set(node, {
      spanId: node.spanId,
      parentSpanId: node.parentSpanId,
      name: node.name,
      kind: node.kind,
      serviceName: node.serviceName,
      startTime: isoFromUs(node.startTimeUs),
      offsetMs: node.offsetMs,
      durationMs: node.durationMs,
      status: node.status,
      orphan: node.orphan,
      genAi: node.genAi,
      content: node.content,
      attributes: node.attributes,
      events: node.events.map((e) => ({ name: e.name, time: isoFromUs(e.timeUs), attributes: e.attributes })),
      children: node.children.map((child) => dtos.get(child)!),
    });
  }
  return roots.map((root) => dtos.get(root)!);
}

export function toTraceDetailResponse(t: TraceDetail): TraceDetailResponse {
  return {
    traceId: t.traceId,
    startTime: isoFromUs(t.startTimeUs),
    durationMs: t.durationMs,
    status: t.status,
    spanCount: t.spanCount,
    errorCount: t.errorCount,
    totalTokens: t.totalTokens,
    truncated: t.truncated,
    conversationId: t.conversationId,
    roots: toSpanNodeDtos(t.roots),
  };
}

export function toOverviewResponse(o: MetricsOverview & { fromMs: number; toMs: number }): OverviewResponse {
  return {
    range: { from: isoFromMs(o.fromMs), to: isoFromMs(o.toMs), bucketSeconds: o.bucketSeconds },
    totals: o.totals,
    latencyMs: o.latencyMs,
    timeseries: o.timeseries.map(({ bucketStartMs, ...rest }) => ({ bucketStart: isoFromMs(bucketStartMs), ...rest })),
    byModel: o.byModel,
    byTool: o.byTool,
  };
}
