import type { ErrorGroupsResult } from "@/domain/error-categories";
import type { UserFeedbackRepository } from "@/application/ports/user-feedback-repository";
import type { UserFeedback } from "@/domain/user-feedback";
import type { ConversationListQuery, SpanListQuery, TraceListQuery, TraceRepository, TraceSpans } from "@/application/ports/trace-repository";
import type { ConversationCursor, ConversationSummary, ConversationUsage } from "@/domain/conversation";
import type { ChatSpanRecord } from "@/domain/transcript";
import type { MetricsOverview, MetricsQuery, ServiceUsage } from "@/domain/metrics";
import type { ModelPricing } from "@/domain/pricing";
import type { Span } from "@/domain/span";
import type { SpanCursor, SpanRecord } from "@/domain/span-row";
import type { TimeRange } from "@/domain/time-range";
import type { Page, TraceStats, TraceSummary } from "@/domain/trace";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { Annotation } from "@/domain/annotation";
import type { AnnotationQueueRepository } from "@/application/ports/annotation-queue-repository";
import type { QueueResolution } from "@/domain/queue-results";
import {
  assertRubricOnlyGrows,
  deriveItemStatus,
  type AnnotationQueue,
  type AnnotationQueuePatch,
  type NewAnnotationQueue,
  type QueueItem,
  type QueueItemStatus,
  type QueueProgress,
  type QueueProvenance,
  type QueueTarget,
  type ReviewerProgress,
} from "@/domain/annotation-queue";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import { AnnotationQueueInvariantError, ScoreConfigInvariantError } from "@/domain/errors";
import type { NewScoreConfig, ScoreConfig, ScoreConfigChanges } from "@/domain/score-config";

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
  totals: { traces: 0, spans: 0, conversations: 0, errorTraces: 0, errorRate: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 },
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
  modelPricing: ModelPricing[] = [];
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
  traceStats = new Map<string, TraceStats>();
  async getTraceStatsForTraces(traceIds: string[]) {
    this.check();
    return new Map(traceIds.flatMap((id) => (this.traceStats.has(id) ? [[id, this.traceStats.get(id)!] as const] : [])));
  }
  async getOverview(query: MetricsQuery) {
    this.check();
    this.lastOverviewQuery = query;
    return this.overview;
  }
  revisions: Array<{ revision: string; traces: number; lastSeenMs: number }> = [];
  async listRevisions(_range: TimeRange) {
    this.check();
    return this.revisions;
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
  conversationUsage = new Map<string, ConversationUsage>();
  async getConversationUsage(ids: string[]) {
    this.check();
    return new Map(ids.flatMap((id) => (this.conversationUsage.has(id) ? [[id, this.conversationUsage.get(id)!] as const] : [])));
  }
  conversationTraceIds = new Map<string, string[]>();
  async getConversationTraceIds(ids: string[]) {
    this.check();
    return new Map(ids.flatMap((id) => (this.conversationTraceIds.has(id) ? [[id, this.conversationTraceIds.get(id)!] as const] : [])));
  }
  async getConversationMessages() {
    this.check();
    return { records: this.chatRecords, truncated: this.chatTruncated };
  }
  async getModelPricing() {
    this.check();
    return this.modelPricing;
  }
  errorGroups: ErrorGroupsResult = { groups: [], tracesWithErrors: 0, conversationsWithErrors: 0, totalTraces: 0, totalConversations: 0 };
  lastErrorQueries: (TimeRange & { service?: string })[] = [];
  async listErrorGroups(query: TimeRange & { service?: string }) {
    this.check();
    this.lastErrorQueries.push(query);
    return this.errorGroups;
  }
  async getStepKinds() {
    this.check();
    return [];
  }
  async getAttributeValues() {
    this.check();
    return [];
  }
  async getAttributeKeys() {
    this.check();
    return [];
  }
  async getCustomMetric() {
    this.check();
    return { points: [], timeseries: [] };
  }
  async ping() {
    this.check();
  }
}

/** Repositorio de score configs en memoria; reproduce la unicidad de nombre entre configs activas del índice parcial. */
export class FakeScoreConfigRepository implements ScoreConfigRepository {
  configs: ScoreConfig[] = [];
  private seq = 0;

  private nameTaken(experimentId: string, name: string, exceptId?: string) {
    return this.configs.some((c) => c.experimentId === experimentId && c.name === name && !c.archivedAt && c.id !== exceptId);
  }
  async list(experimentId: string, includeArchived: boolean) {
    return this.configs.filter((c) => c.experimentId === experimentId && (includeArchived || !c.archivedAt));
  }
  async get(experimentId: string, configId: string) {
    return this.configs.find((c) => c.experimentId === experimentId && c.id === configId) ?? null;
  }
  async create(experimentId: string, createdByUserId: string, input: NewScoreConfig) {
    if (this.nameTaken(experimentId, input.name)) throw new ScoreConfigInvariantError(`name "${input.name}" taken`);
    this.seq += 1;
    const now = "2026-10-03T00:00:00.000Z";
    const config: ScoreConfig = { ...input, targetPassRate: input.targetPassRate ?? null, id: `cfg-${this.seq}`, experimentId, createdBy: createdByUserId, createdAt: now, updatedAt: now, archivedAt: null };
    this.configs.push(config);
    return config;
  }
  async update(experimentId: string, configId: string, changes: ScoreConfigChanges) {
    const config = await this.get(experimentId, configId);
    if (!config) return null;
    Object.assign(config, changes);
    return config;
  }
  async setArchived(experimentId: string, configId: string, archived: boolean) {
    const config = await this.get(experimentId, configId);
    if (!config) return null;
    if (!archived && this.nameTaken(experimentId, config.name, config.id)) throw new ScoreConfigInvariantError(`name "${config.name}" taken`);
    config.archivedAt = archived ? "2026-10-03T00:00:00.000Z" : null;
    return config;
  }
}

/** Anotaciones en memoria con la misma semántica de clave que la tabla: (traza, span, config, anotador), la última escritura gana. */
export class FakeAnnotationRepository implements AnnotationRepository {
  rows: Array<{ serviceName: string; annotation: Annotation; isDeleted: boolean }> = [];

  private sameKey(a: Annotation, b: Annotation) {
    return a.traceId === b.traceId && (a.datasetRunId ?? null) === (b.datasetRunId ?? null) && (a.itemIndex ?? null) === (b.itemIndex ?? null) && a.spanId === b.spanId && a.configId === b.configId && a.annotatorId === b.annotatorId;
  }
  private put(serviceName: string, annotation: Annotation, isDeleted: boolean) {
    this.rows = this.rows.filter((r) => !(r.serviceName === serviceName && this.sameKey(r.annotation, annotation)));
    this.rows.push({ serviceName, annotation, isDeleted });
  }
  async upsert(serviceName: string, annotation: Annotation) {
    this.put(serviceName, annotation, false);
  }
  async retract(serviceName: string, annotation: Annotation) {
    this.put(serviceName, annotation, true);
  }
  async listForTrace(serviceName: string, traceId: string) {
    return this.rows.filter((r) => r.serviceName === serviceName && r.annotation.traceId === traceId && !r.annotation.datasetRunId && !r.isDeleted).map((r) => r.annotation);
  }
  async listForRuns(serviceName: string, datasetRunIds: string[], configName?: string) {
    return this.rows
      .filter((r) => r.serviceName === serviceName && !r.isDeleted && !!r.annotation.datasetRunId && datasetRunIds.includes(r.annotation.datasetRunId) && (configName === undefined || r.annotation.configName === configName))
      .map((r) => r.annotation);
  }
  async listRecentForTraces(serviceName: string, fromMs: number, toMs: number, limit: number) {
    return this.rows
      .filter((r) => r.serviceName === serviceName && !r.isDeleted && !r.annotation.datasetRunId && r.annotation.spanId === null)
      .map((r) => r.annotation)
      .filter((a) => Date.parse(a.createdAt) >= fromMs && Date.parse(a.createdAt) < toMs)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }
  async listForTraces(serviceName: string, traceIds: string[], configName?: string) {
    return this.rows
      .filter((r) => r.serviceName === serviceName && !r.isDeleted && !r.annotation.datasetRunId && r.annotation.spanId === null && traceIds.includes(r.annotation.traceId) && (configName === undefined || r.annotation.configName === configName))
      .map((r) => r.annotation);
  }
}

/** Feedback de usuario final en memoria con la misma semántica de clave que la tabla: (traza, span, usuario final), la última escritura gana. */
export class FakeUserFeedbackRepository implements UserFeedbackRepository {
  rows: Array<{ serviceName: string; feedback: UserFeedback; isDeleted: boolean }> = [];

  private put(serviceName: string, feedback: UserFeedback, isDeleted: boolean) {
    this.rows = this.rows.filter((r) => !(r.serviceName === serviceName && r.feedback.traceId === feedback.traceId && r.feedback.spanId === feedback.spanId && r.feedback.endUserId === feedback.endUserId));
    this.rows.push({ serviceName, feedback, isDeleted });
  }
  private live(serviceName: string) {
    return this.rows.filter((r) => r.serviceName === serviceName && !r.isDeleted).map((r) => r.feedback);
  }
  async upsert(serviceName: string, feedback: UserFeedback) {
    this.put(serviceName, feedback, false);
  }
  async retract(serviceName: string, feedback: UserFeedback) {
    this.put(serviceName, feedback, true);
  }
  async listForTrace(serviceName: string, traceId: string) {
    return this.live(serviceName).filter((f) => f.traceId === traceId);
  }
  async listForTraces(serviceName: string, traceIds: string[]) {
    return this.live(serviceName).filter((f) => traceIds.includes(f.traceId));
  }
  private inRange(serviceName: string, fromMs: number, toMs: number) {
    return this.live(serviceName).filter((f) => Date.parse(f.createdAt) >= fromMs && Date.parse(f.createdAt) < toMs);
  }
  async summarize(serviceName: string, fromMs: number, toMs: number) {
    const votes = this.inRange(serviceName, fromMs, toMs);
    const up = votes.filter((v) => v.rating === 1).length;
    const total = votes.length;
    return { total, up, down: total - up, satisfaction: total === 0 ? null : Math.round((up / total) * 1000) / 10, ratedTraces: new Set(votes.map((v) => v.traceId)).size };
  }
  async daily(serviceName: string, fromMs: number, toMs: number) {
    const byDay = new Map<string, { up: number; down: number }>();
    for (const v of this.inRange(serviceName, fromMs, toMs)) {
      const day = v.createdAt.slice(0, 10);
      const entry = byDay.get(day) ?? { up: 0, down: 0 };
      if (v.rating === 1) entry.up += 1;
      else entry.down += 1;
      byDay.set(day, entry);
    }
    return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, c]) => ({ day, ...c }));
  }
  async listRecent(serviceName: string, fromMs: number, toMs: number, limit: number, rating?: 1 | -1) {
    return this.inRange(serviceName, fromMs, toMs)
      .filter((v) => rating === undefined || v.rating === rating)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }
}

/** Cola de anotación en memoria: reproduce claims por revisor y el estado derivado, sin concurrencia ni lease (eso lo prueba la integración con Postgres). */
export class FakeAnnotationQueueRepository implements AnnotationQueueRepository {
  queues: AnnotationQueue[] = [];
  items: QueueItem[] = [];
  claims: Array<{ itemId: string; userId: string; completed: boolean; skipped: boolean }> = [];
  failCompleteWith?: Error;
  private seq = 0;

  private id(prefix: string) {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
  private recompute(queue: AnnotationQueue, item: QueueItem) {
    const done = this.claims.filter((c) => c.itemId === item.id && c.completed).length;
    item.status = deriveItemStatus(item.status, done, queue.requiredAnnotations);
    item.completedAt = item.status === "completed" ? (item.completedAt ?? "2026-10-03T00:00:00.000Z") : null;
  }

  async list(experimentId: string, includeArchived: boolean) {
    const queues = this.queues.filter((q) => q.experimentId === experimentId && (includeArchived || !q.archivedAt));
    return Promise.all(queues.map(async (queue) => ({ queue, progress: await this.progress(queue.id), toCurate: 0 })));
  }
  async get(experimentId: string, queueId: string) {
    return this.queues.find((q) => q.experimentId === experimentId && q.id === queueId) ?? null;
  }
  async progress(queueId: string): Promise<QueueProgress> {
    const items = this.items.filter((i) => i.queueId === queueId);
    return { pending: items.filter((i) => i.status === "pending").length, completed: items.filter((i) => i.status === "completed").length, skipped: items.filter((i) => i.status === "skipped").length };
  }
  async reviewers(queueId: string): Promise<ReviewerProgress[]> {
    const ids = new Set(this.items.filter((i) => i.queueId === queueId).map((i) => i.id));
    const mine = this.claims.filter((c) => ids.has(c.itemId));
    return [...new Set(mine.map((c) => c.userId))].map((userId) => ({
      userId,
      completed: mine.filter((c) => c.userId === userId && c.completed).length,
      skipped: mine.filter((c) => c.userId === userId && c.skipped && !c.completed).length,
      inProgress: mine.filter((c) => c.userId === userId && !c.completed && !c.skipped).length,
    }));
  }
  async create(experimentId: string, createdByUserId: string, input: NewAnnotationQueue) {
    if (this.queues.some((q) => q.experimentId === experimentId && q.name === input.name && !q.archivedAt)) throw new AnnotationQueueInvariantError(`name "${input.name}" taken`);
    const queue: AnnotationQueue = {
      id: this.id("q"),
      experimentId,
      name: input.name,
      instructions: input.instructions,
      requiredAnnotations: input.requiredAnnotations,
      reviewerIds: [...input.reviewerIds],
      rubric: input.rubric.map((r, position) => ({ ...r, position })),
      createdBy: createdByUserId,
      createdAt: "2026-10-03T00:00:00.000Z",
      archivedAt: null,
    };
    this.queues.push(queue);
    return queue;
  }
  async update(experimentId: string, queueId: string, patch: AnnotationQueuePatch) {
    const queue = await this.get(experimentId, queueId);
    if (!queue) return null;
    if (patch.rubric) {
      if (this.items.some((i) => i.queueId === queueId)) assertRubricOnlyGrows(queue.rubric, patch.rubric);
      queue.rubric = patch.rubric.map((r, position) => ({ ...r, position }));
    }
    if (patch.reviewerIds) queue.reviewerIds = [...patch.reviewerIds];
    if (patch.name !== undefined) queue.name = patch.name;
    if (patch.instructions !== undefined) queue.instructions = patch.instructions;
    if (patch.archived !== undefined) queue.archivedAt = patch.archived ? "2026-10-03T00:00:00.000Z" : null;
    if (patch.requiredAnnotations !== undefined && patch.requiredAnnotations !== queue.requiredAnnotations) {
      queue.requiredAnnotations = patch.requiredAnnotations;
      for (const item of this.items.filter((i) => i.queueId === queueId)) this.recompute(queue, item);
    }
    return queue;
  }
  async addItems(queueId: string, addedBy: string, targets: QueueTarget[], provenance: QueueProvenance = { population: "manual", seed: null }) {
    let added = 0;
    for (const t of targets) {
      const item: QueueItem = {
        id: this.id("i"),
        queueId,
        targetType: t.targetType,
        traceId: t.targetType === "trace" ? t.traceId : null,
        datasetRunId: t.targetType === "run_item" ? t.datasetRunId : null,
        itemIndex: t.targetType === "run_item" ? t.itemIndex : null,
        status: "pending",
        population: provenance.population,
        sampleSeed: provenance.seed,
        addedBy,
        addedAt: `2026-10-03T00:00:${String(this.items.length).padStart(2, "0")}.000Z`,
        completedAt: null,
      };
      const dup = this.items.some((i) => i.queueId === queueId && i.traceId === item.traceId && i.datasetRunId === item.datasetRunId && i.itemIndex === item.itemIndex);
      if (!dup) {
        this.items.push(item);
        added += 1;
      }
    }
    return { added, duplicates: targets.length - added };
  }
  async listItems(queueId: string, status: QueueItemStatus | undefined, limit: number) {
    return this.items.filter((i) => i.queueId === queueId && (!status || i.status === status)).slice(0, limit);
  }
  async getItem(queueId: string, itemId: string) {
    return this.items.find((i) => i.queueId === queueId && i.id === itemId) ?? null;
  }
  async claimNext(queue: AnnotationQueue, userId: string) {
    const open = this.claims.find((c) => c.userId === userId && !c.completed && !c.skipped && this.items.find((i) => i.id === c.itemId)?.queueId === queue.id);
    if (open) return this.items.find((i) => i.id === open.itemId)!;
    const item = this.items.find(
      (i) =>
        i.queueId === queue.id &&
        i.status === "pending" &&
        !this.claims.some((c) => c.itemId === i.id && c.userId === userId) &&
        this.claims.filter((c) => c.itemId === i.id && !c.skipped).length < queue.requiredAnnotations,
    );
    if (!item) return null;
    this.claims.push({ itemId: item.id, userId, completed: false, skipped: false });
    return item;
  }
  async hasClaim(itemId: string, userId: string) {
    return this.claims.some((c) => c.itemId === itemId && c.userId === userId);
  }
  async completeClaim(queue: AnnotationQueue, itemId: string, userId: string) {
    if (this.failCompleteWith) throw this.failCompleteWith;
    const claim = this.claims.find((c) => c.itemId === itemId && c.userId === userId);
    if (claim) Object.assign(claim, { completed: true, skipped: false });
    else this.claims.push({ itemId, userId, completed: true, skipped: false });
    const item = this.items.find((i) => i.id === itemId)!;
    this.recompute(queue, item);
    return item;
  }
  async skipClaim(_queue: AnnotationQueue, itemId: string, userId: string) {
    const claim = this.claims.find((c) => c.itemId === itemId && c.userId === userId);
    if (claim && !claim.completed) claim.skipped = true;
    return this.items.find((i) => i.id === itemId)!;
  }
  async markUnreviewable(queueId: string, itemId: string) {
    const item = await this.getItem(queueId, itemId);
    if (item) item.status = "skipped";
    return item;
  }
  resolutions: QueueResolution[] = [];
  async listQueuesForTrace(experimentId: string, traceId: string) {
    return this.items
      .filter((i) => i.traceId === traceId)
      .flatMap((i) => {
        const q = this.queues.find((x) => x.id === i.queueId && x.experimentId === experimentId);
        return q ? [{ queueId: q.id, queueName: q.name, archived: q.archivedAt !== null, itemStatus: i.status }] : [];
      });
  }
  async listResolutions(queueId: string, itemIds: string[]) {
    const ids = new Set(this.items.filter((i) => i.queueId === queueId && itemIds.includes(i.id)).map((i) => i.id));
    return this.resolutions.filter((r) => ids.has(r.queueItemId));
  }
  async upsertResolution(_queueId: string, resolution: Omit<QueueResolution, "resolvedAt">) {
    const saved: QueueResolution = { ...resolution, resolvedAt: "2026-10-04T00:00:00.000Z" };
    this.resolutions = [...this.resolutions.filter((r) => !(r.queueItemId === resolution.queueItemId && r.configId === resolution.configId)), saved];
    return saved;
  }
  async deleteResolution(_queueId: string, itemId: string, configId: string) {
    const before = this.resolutions.length;
    this.resolutions = this.resolutions.filter((r) => !(r.queueItemId === itemId && r.configId === configId));
    return this.resolutions.length < before;
  }
}
