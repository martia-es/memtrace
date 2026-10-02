import type { ConversationCursor, ConversationSummary } from "@/domain/conversation";
import type { AttributeKeyCount, AttributeValueCount, CustomMetricResult, MetricsOverview, ServiceUsage, StepKindCount } from "@/domain/metrics";
import type { CustomMetric, Dataset, DatasetItem, DatasetRun, DatasetRunWithDataset, DatasetVersion, MetricReport, MetricReportWithCharts } from "@/domain/identity";
import type { DatasetRunItemResult, ScoreAggregate } from "@/domain/evaluation";
import type { ModelPricing } from "@/domain/pricing";
import type { SpanCursor, SpanRow } from "@/domain/span-row";
import type { Transcript } from "@/domain/transcript";
import type { SpanNode } from "@/domain/span";
import type { Page, TraceDetail, TraceSummary } from "@/domain/trace";
import type {
  AttributeKeysResponse,
  AttributeValuesResponse,
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationSummaryDto,
  ConversationTreeResponse,
  CustomMetricDefinitionDto,
  CustomMetricResultResponse,
  CustomMetricsListResponse,
  DatasetDto,
  DatasetItemDto,
  DatasetItemsListResponse,
  DatasetRunDetailResponse,
  DatasetRunItemResultDto,
  DatasetRunSummaryDto,
  DatasetRunsListResponse,
  DatasetsListResponse,
  DatasetVersionDto,
  DatasetVersionsListResponse,
  RunListItemDto,
  RunsListResponse,
  ScoreAggregateDto,
  ExperimentUsageResponse,
  MetricReportDto,
  MetricReportsListResponse,
  MetricReportSummaryDto,
  ModelPricingResponse,
  OverviewResponse,
  SavedCustomMetricDto,
  SpanListResponse,
  SpanNodeDto,
  StepKindsResponse,
  TraceDetailResponse,
  TraceListResponse,
  TraceSummaryDto,
  TranscriptResponse,
} from "./contract";
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
    input: t.input,
    output: t.output,
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
      costUsd: node.costUsd,
      content: node.content,
      framework: node.framework,
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
    totalCostUsd: t.totalCostUsd,
    truncated: t.truncated,
    conversationId: t.conversationId,
    framework: t.framework,
    roots: toSpanNodeDtos(t.roots),
  };
}

export function toConversationTreeResponse(page: Page<TraceDetail>): ConversationTreeResponse {
  return { items: page.items.map(toTraceDetailResponse), nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null };
}

export function toOverviewResponse(o: MetricsOverview & { fromMs: number; toMs: number }): OverviewResponse {
  return {
    range: { from: isoFromMs(o.fromMs), to: isoFromMs(o.toMs), bucketSeconds: o.bucketSeconds },
    totals: o.totals,
    latencyMs: o.latencyMs,
    timeseries: o.timeseries.map(({ bucketStartMs, ...rest }) => ({ bucketStart: isoFromMs(bucketStartMs), ...rest })),
    byModel: o.byModel,
    byTool: o.byTool,
    byTopic: o.byTopic,
  };
}

/** Cruza los experimentos visibles con su uso por ServiceName; sin datos en el rango = ceros, no se omite. */
export function toExperimentUsageResponse(experiments: { id: string; name: string; serviceName: string }[], items: ServiceUsage[]): ExperimentUsageResponse {
  const byService = new Map(items.map((i) => [i.serviceName, i]));
  return {
    items: experiments.map((e) => {
      const usage = byService.get(e.serviceName);
      return {
        experimentId: e.id,
        experimentName: e.name,
        traces: usage?.traces ?? 0,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      };
    }),
  };
}

// ----- Custom metrics sobre spans definidos por el usuario (ADR-027) -----

export function toStepKindsResponse(items: StepKindCount[]): StepKindsResponse {
  return { items };
}

export function toAttributeValuesResponse(items: AttributeValueCount[]): AttributeValuesResponse {
  return { items };
}

/** (ADR-030) */
export function toAttributeKeysResponse(items: AttributeKeyCount[]): AttributeKeysResponse {
  return { items };
}

export function toCustomMetricResultResponse(result: CustomMetricResult): CustomMetricResultResponse {
  return {
    points: result.points,
    timeseries: result.timeseries.map(({ bucketStartMs, points }) => ({ bucketStart: isoFromMs(bucketStartMs), points })),
  };
}

function toCustomMetricDefinitionDto(definition: Record<string, unknown>): CustomMetricDefinitionDto {
  // ya validado por zod al guardar (saveCustomMetricBody): aquí solo se re-tipa lo que salió de Postgres.
  return definition as unknown as CustomMetricDefinitionDto;
}

export function toSavedCustomMetricDto(m: CustomMetric): SavedCustomMetricDto {
  return { id: m.id, name: m.name, definition: toCustomMetricDefinitionDto(m.definition), createdAt: m.createdAt };
}

export function toCustomMetricsListResponse(items: CustomMetric[]): CustomMetricsListResponse {
  return { items: items.map(toSavedCustomMetricDto) };
}

export function toMetricReportSummaryDto(r: MetricReport): MetricReportSummaryDto {
  return { id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function toMetricReportsListResponse(items: MetricReport[]): MetricReportsListResponse {
  return { items: items.map(toMetricReportSummaryDto) };
}

export function toMetricReportDto(r: MetricReportWithCharts): MetricReportDto {
  return {
    ...toMetricReportSummaryDto(r),
    charts: r.charts.map((c) => ({
      customMetricId: c.customMetricId,
      name: c.name,
      definition: toCustomMetricDefinitionDto(c.definition),
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h,
    })),
  };
}

/** Evaluación offline (ADR-028). */

export function toDatasetItemDto(item: DatasetItem): DatasetItemDto {
  return {
    id: item.id,
    datasetVersionId: item.datasetVersionId,
    input: item.input,
    expectedOutput: item.expectedOutput,
    metadata: item.metadata,
    createdByEmail: item.createdByEmail,
    createdAt: item.createdAt,
    updatedByEmail: item.updatedByEmail,
    updatedAt: item.updatedAt,
    deletedByEmail: item.deletedByEmail,
    deletedAt: item.deletedAt,
  };
}

export function toDatasetItemsListResponse(items: DatasetItem[]): DatasetItemsListResponse {
  return { items: items.map(toDatasetItemDto) };
}

function toDatasetVersionDto(version: DatasetVersion, itemCount: number): DatasetVersionDto {
  return { id: version.id, major: version.major, minor: version.minor, note: version.note, createdByEmail: version.createdByEmail, createdAt: version.createdAt, itemCount };
}

export function toDatasetVersionsListResponse(versions: Array<{ version: DatasetVersion; itemCount: number }>): DatasetVersionsListResponse {
  return { items: versions.map((v) => toDatasetVersionDto(v.version, v.itemCount)) };
}

export function toScoreAggregateDto(a: ScoreAggregate): ScoreAggregateDto {
  return { name: a.name, dataType: a.dataType, passRate: a.passRate, average: a.average, count: a.count };
}

/** Agrupa un `ScoreAggregate[]` plano (una fila por run x evaluador) por `datasetRunId`, para
 * adjuntar a cada run su propio subconjunto. Función pura, sin dependencia de ClickHouse. */
export function groupAggregatesByRun(aggregates: ScoreAggregate[]): Map<string, ScoreAggregateDto[]> {
  const byRun = new Map<string, ScoreAggregateDto[]>();
  for (const a of aggregates) {
    const list = byRun.get(a.datasetRunId) ?? [];
    list.push(toScoreAggregateDto(a));
    byRun.set(a.datasetRunId, list);
  }
  return byRun;
}

export function toDatasetRunSummaryDto(run: DatasetRun, aggregates: ScoreAggregateDto[] = []): DatasetRunSummaryDto {
  return { id: run.id, name: run.name, versionMajor: run.versionMajor, versionMinor: run.versionMinor, itemCount: run.itemCount, createdAt: run.createdAt, aggregates };
}

export function toDatasetRunsListResponse(runs: DatasetRun[], aggregatesByRun: Map<string, ScoreAggregateDto[]>): DatasetRunsListResponse {
  return { items: runs.map((r) => toDatasetRunSummaryDto(r, aggregatesByRun.get(r.id) ?? [])) };
}

export function toRunListItemDto(run: DatasetRunWithDataset, aggregates: ScoreAggregateDto[] = []): RunListItemDto {
  return { ...toDatasetRunSummaryDto(run, aggregates), datasetId: run.datasetId, datasetName: run.datasetName };
}

export function toRunsListResponse(runs: DatasetRunWithDataset[], aggregatesByRun: Map<string, ScoreAggregateDto[]>): RunsListResponse {
  return { items: runs.map((r) => toRunListItemDto(r, aggregatesByRun.get(r.id) ?? [])) };
}

export function toDatasetDto(
  dataset: Dataset,
  runCount: number,
  versionCount: number,
  latestVersionMajor: number,
  latestVersionMinor: number,
  lastRun: DatasetRun | null,
  lastRunAggregates: ScoreAggregateDto[] = [],
): DatasetDto {
  return {
    id: dataset.id,
    name: dataset.name,
    createdAt: dataset.createdAt,
    runCount,
    versionCount,
    latestVersionMajor,
    latestVersionMinor,
    lastRun: lastRun ? { id: lastRun.id, name: lastRun.name, createdAt: lastRun.createdAt, itemCount: lastRun.itemCount, aggregates: lastRunAggregates } : null,
  };
}

export interface DatasetListEntry {
  dataset: Dataset;
  runCount: number;
  versionCount: number;
  latestVersionMajor: number;
  latestVersionMinor: number;
  lastRun: DatasetRun | null;
  lastRunAggregates: ScoreAggregateDto[];
}

export function toDatasetsListResponse(entries: DatasetListEntry[]): DatasetsListResponse {
  return { items: entries.map((e) => toDatasetDto(e.dataset, e.runCount, e.versionCount, e.latestVersionMajor, e.latestVersionMinor, e.lastRun, e.lastRunAggregates)) };
}

function toDatasetRunItemResultDto(item: DatasetRunItemResult): DatasetRunItemResultDto {
  return {
    itemIndex: item.itemIndex,
    input: item.input,
    expectedOutput: item.expectedOutput,
    output: item.output,
    traceId: item.traceId,
    error: item.error,
    scores: item.scores,
  };
}

export function toDatasetRunDetailResponse(dataset: Dataset, run: DatasetRun, items: DatasetRunItemResult[], aggregates: ScoreAggregateDto[] = []): DatasetRunDetailResponse {
  return { dataset: { id: dataset.id, name: dataset.name }, run: toDatasetRunSummaryDto(run, aggregates), items: items.map(toDatasetRunItemResultDto) };
}

/** Catálogo de precios por modelo, para la vista de precios (ADR-025). */
export function toModelPricingResponse(items: ModelPricing[]): ModelPricingResponse {
  return {
    items: items.map((p) => ({
      modelId: p.modelId,
      provider: p.provider,
      inputPricePerToken: p.inputPricePerToken,
      outputPricePerToken: p.outputPricePerToken,
      source: p.source,
      updatedAt: isoFromMs(p.updatedAtMs),
    })),
  };
}
