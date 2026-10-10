import type { ConversationCursor, ConversationListItem } from "@/domain/conversation";
import type { ErrorOverview } from "@/domain/error-categories";
import { classifyAttribute } from "@/domain/attribute-classification";
import type { AttributeKeyCount, AttributeValueCount, CustomMetricResult, MetricsOverview, ServiceUsage, StepKindCount } from "@/domain/metrics";
import type { DatasetVersionDiff } from "@/domain/dataset-diff";
import type { CustomMetric, Dataset, DatasetItem, DatasetRun, DatasetRunWithDataset, DatasetVersion, MetricReport, MetricReportWithCharts } from "@/domain/identity";
import type { DatasetRunItemResult, ScoreAggregate } from "@/domain/evaluation";
import type { ScoreConfig } from "@/domain/score-config";
import type { AnnotationQueue, QueueItem } from "@/domain/annotation-queue";
import type { QueueDetail, QueueListItem, QueueResults } from "@/application/annotation-queue-service";
import type { QueueResolution } from "@/domain/queue-results";
import type { InterAnnotatorResult, JudgeHumanResult } from "@/application/agreement-service";
import type { TraceJudgments } from "@/application/annotation-service";
import type { LowRatedSummary } from "@/domain/annotation";
import type { FeedbackOverview, TraceFeedback } from "@/application/user-feedback-service";
import type { PromotionResult } from "@/application/dataset-promotion-service";
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
  PromoteTracesResponse,
  DatasetRunDetailResponse,
  DatasetRunItemResultDto,
  DatasetRunSummaryDto,
  DatasetRunsListResponse,
  DatasetsListResponse,
  DatasetVersionDiffResponse,
  DatasetVersionDto,
  DatasetVersionRefDto,
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
  ErrorOverviewResponse,
  SavedCustomMetricDto,
  ScoreConfigDto,
  AnnotationQueueDetailResponse,
  InterAnnotatorAgreementResponse,
  JudgeHumanAgreementResponse,
  AnnotationQueueDto,
  AnnotationQueuesListResponse,
  QueueItemDto,
  QueueResolutionDto,
  QueueResultsResponse,
  ScoreConfigsListResponse,
  LowRatedResponse,
  TraceAnnotationsResponse,
  TraceFeedbackResponse,
  FeedbackOverviewResponse,
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
    error: t.error,
    conversationId: t.conversationId,
    revision: t.revision,
    prompts: t.prompts,
  };
}

export function toConversationSummaryDto(c: ConversationListItem): ConversationSummaryDto {
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
    title: c.title,
    costUsd: c.costUsd,
    prompts: c.prompts,
  };
}

export function toConversationListResponse(page: Page<ConversationListItem, ConversationCursor>): ConversationListResponse {
  return {
    items: page.items.map(toConversationSummaryDto),
    nextCursor: page.nextCursor ? encodeConversationCursor(page.nextCursor) : null,
  };
}

export function toConversationDetailResponse(conversation: ConversationListItem, turns: Page<TraceSummary>): ConversationDetailResponse {
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
    revision: t.revision,
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

export function toErrorOverviewResponse(o: ErrorOverview): ErrorOverviewResponse {
  const iso = (r: { fromMs: number; toMs: number }) => ({ from: isoFromMs(r.fromMs), to: isoFromMs(r.toMs) });
  return {
    range: iso(o.range),
    previousRange: o.previousRange ? iso(o.previousRange) : null,
    totals: o.totals,
    categories: o.categories.map(({ firstSeenMs, lastSeenMs, ...c }) => ({ ...c, firstSeen: isoFromMs(firstSeenMs), lastSeen: isoFromMs(lastSeenMs) })),
  };
}

/** Cruza los experimentos visibles con su uso por experimento (ADR-088); sin datos en el rango = ceros, no se omite. */
export function toExperimentUsageResponse(experiments: { id: string; name: string; serviceName: string }[], items: ServiceUsage[]): ExperimentUsageResponse {
  const byExperiment = new Map(items.map((i) => [i.experimentId, i]));
  return {
    items: experiments.map((e) => {
      const usage = byExperiment.get(e.id);
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
  return {
    items: items.map((stats) => {
      const { kind, numeric, hiddenByDefault } = classifyAttribute(stats);
      return { key: stats.key, count: stats.count, kind, distinct: stats.distinct, numeric, hiddenByDefault };
    }),
  };
}

export function toCustomMetricResultResponse(result: CustomMetricResult): CustomMetricResultResponse {
  return {
    points: result.points,
    timeseries: result.timeseries.map(({ bucketStartMs, points }) => ({ bucketStart: isoFromMs(bucketStartMs), points })),
  };
}

function toCustomMetricDefinitionDto(definition: Record<string, unknown>): CustomMetricDefinitionDto {
  // ya validado por zod al guardar (saveCustomMetricBody): aquí solo se re-tipa lo que salió de Postgres. Los gráficos guardados antes de las
  // métricas sobre atributos (ADR-078) no traen `metricAttribute`: se leen como null.
  return { ...definition, metricAttribute: (definition.metricAttribute as string | null | undefined) ?? null } as unknown as CustomMetricDefinitionDto;
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

export function toDatasetItemsListResponse(items: DatasetItem[], version?: DatasetVersion): DatasetItemsListResponse {
  return { items: items.map(toDatasetItemDto), ...(version && { version: toVersionRefDto(version) }) };
}

export function toPromoteTracesResponse(result: PromotionResult): PromoteTracesResponse {
  return { added: result.added.map(toDatasetItemDto), skipped: result.skipped, version: result.version && toVersionRefDto(result.version) };
}

export interface DatasetVersionSummary {
  version: DatasetVersion;
  itemCount: number;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

function toDatasetVersionDto(v: DatasetVersionSummary): DatasetVersionDto {
  const { version } = v;
  return {
    id: version.id,
    major: version.major,
    minor: version.minor,
    note: version.note,
    createdByEmail: version.createdByEmail,
    createdAt: version.createdAt,
    itemCount: v.itemCount,
    addedCount: v.addedCount,
    modifiedCount: v.modifiedCount,
    removedCount: v.removedCount,
  };
}

export function toDatasetVersionsListResponse(versions: DatasetVersionSummary[]): DatasetVersionsListResponse {
  return { items: versions.map(toDatasetVersionDto) };
}

function toVersionRefDto(version: DatasetVersion): DatasetVersionRefDto {
  return { id: version.id, major: version.major, minor: version.minor };
}

export function toDatasetVersionDiffResponse(base: DatasetVersion | null, target: DatasetVersion, diff: DatasetVersionDiff): DatasetVersionDiffResponse {
  return {
    base: base ? toVersionRefDto(base) : null,
    target: toVersionRefDto(target),
    unchangedCount: diff.unchangedCount,
    changes: diff.changes.map((c) => ({ originItemId: c.originItemId, kind: c.kind, before: c.before && toDatasetItemDto(c.before), after: c.after && toDatasetItemDto(c.after) })),
  };
}

export function toScoreAggregateDto(a: ScoreAggregate): ScoreAggregateDto {
  return { name: a.name, dataType: a.dataType, passRate: a.passRate, average: a.average, count: a.count, judges: a.judges };
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
  return { id: run.id, name: run.name, versionMajor: run.versionMajor, versionMinor: run.versionMinor, itemCount: run.itemCount, status: run.status, createdAt: run.createdAt, revision: run.revision, revisionDirty: run.revisionDirty, aggregates };
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
    telemetry: item.telemetry ?? null,
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

export function toScoreConfigDto(c: ScoreConfig): ScoreConfigDto {
  return {
    id: c.id,
    name: c.name,
    dataType: c.dataType,
    minValue: c.minValue,
    maxValue: c.maxValue,
    categories: c.categories,
    targetPassRate: c.targetPassRate,
    description: c.description,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    archivedAt: c.archivedAt,
  };
}

export function toScoreConfigsListResponse(items: ScoreConfig[]): ScoreConfigsListResponse {
  return { items: items.map(toScoreConfigDto) };
}

export const toLowRatedResponse = (summary: LowRatedSummary): LowRatedResponse => ({ count: summary.count, items: summary.items });

export function toTraceAnnotationsResponse(judgments: TraceJudgments): TraceAnnotationsResponse {
  return {
    annotations: judgments.annotations.map((a) => ({
      configId: a.configId,
      configName: a.configName,
      dataType: a.dataType,
      value: a.value,
      comment: a.comment,
      spanId: a.spanId,
      annotator: { id: a.annotatorId, name: a.annotatorName },
      createdAt: a.createdAt,
    })),
    scores: judgments.scores,
  };
}

export function toAnnotationQueueDto(q: AnnotationQueue): AnnotationQueueDto {
  return {
    id: q.id,
    name: q.name,
    instructions: q.instructions,
    requiredAnnotations: q.requiredAnnotations,
    reviewerIds: q.reviewerIds,
    rubric: q.rubric.map((r) => ({ configId: r.configId, required: r.required })),
    createdAt: q.createdAt,
    archivedAt: q.archivedAt,
  };
}

export function toAnnotationQueuesListResponse(items: QueueListItem[]): AnnotationQueuesListResponse {
  return { items: items.map(({ queue, progress, toCurate, assignedReviewers, isReviewer }) => ({ ...toAnnotationQueueDto(queue), progress, toCurate, assignedReviewers, isReviewer })) };
}

export function toAnnotationQueueDetailResponse(detail: QueueDetail): AnnotationQueueDetailResponse {
  return {
    ...toAnnotationQueueDto(detail.queue),
    progress: detail.progress,
    configs: detail.configs.map(toScoreConfigDto),
    reviewers: detail.reviewers,
  };
}

export function toQueueItemDto(i: QueueItem): QueueItemDto {
  return {
    id: i.id,
    targetType: i.targetType,
    traceId: i.traceId,
    datasetRunId: i.datasetRunId,
    itemIndex: i.itemIndex,
    status: i.status,
    population: i.population,
    addedAt: i.addedAt,
    completedAt: i.completedAt,
  };
}

export function toQueueResolutionDto(r: QueueResolution): QueueResolutionDto {
  return { value: r.value, expectedOutput: r.expectedOutput, resolvedBy: r.resolvedBy, resolvedAt: r.resolvedAt };
}

export function toQueueResultsResponse(results: QueueResults): QueueResultsResponse {
  return {
    configs: results.configs.map(toScoreConfigDto),
    total: results.total,
    items: results.items.map(({ item, criteria, needsResolution, promotedTo }) => ({
      ...toQueueItemDto(item),
      needsResolution,
      promotedTo: promotedTo.map((p) => ({ datasetId: p.datasetId, datasetName: p.datasetName, version: p.version })),
      criteria: criteria.map((c) => ({ configId: c.configId, status: c.status, labels: c.labels, resolution: c.resolution ? toQueueResolutionDto(c.resolution) : null })),
    })),
  };
}

/** El resultado del servicio ya tiene la forma del contrato; el tipo de retorno hace que el compilador avise si divergen. */
export function toJudgeHumanAgreementResponse(result: JudgeHumanResult): JudgeHumanAgreementResponse {
  return result;
}

export function toInterAnnotatorAgreementResponse(result: InterAnnotatorResult): InterAnnotatorAgreementResponse {
  return result;
}

export function toTraceFeedbackResponse(feedback: TraceFeedback): TraceFeedbackResponse {
  return {
    votes: feedback.votes.map((v) => ({
      rating: v.rating,
      comment: v.comment,
      spanId: v.spanId,
      endUserId: v.endUserId,
      externalMessageId: v.externalMessageId,
      createdAt: v.createdAt,
    })),
    alignment: feedback.alignment,
  };
}

export const toFeedbackOverviewResponse = (overview: FeedbackOverview): FeedbackOverviewResponse => overview;
