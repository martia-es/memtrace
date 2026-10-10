import { tenantOf } from "@/domain/tenant";
import type { AnnotationQueueRepository, QueueWithProgress, TraceQueueMembership } from "@/application/ports/annotation-queue-repository";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { IdentityRepository, PromotedTraceLocation } from "@/application/ports/identity-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import { validateAnnotationValue, type Annotation, type AnnotationValue } from "@/domain/annotation";
import { randomUUID } from "node:crypto";
import {
  MAX_ITEMS_PER_REQUEST,
  validateNewQueue,
  validateQueueLabels,
  type AnnotationQueue,
  type AnnotationQueuePatch,
  type NewAnnotationQueue,
  type QueueItem,
  type QueueItemStatus,
  type QueueLabel,
  type QueueProgress,
  type QueueProvenance,
  type QueueTarget,
  type ReviewerProgress,
} from "@/domain/annotation-queue";
import { AnnotationQueueInvariantError, AnnotationQueueNotFoundError, AnnotationQueueReviewerError, ScoreConfigNotFoundError, ValidationError } from "@/domain/errors";
import type { Member } from "@/domain/identity";
import type { ScoreConfig } from "@/domain/score-config";
import { criterionStatus, type CriterionStatus, type QueueResolution, type ResultLabel } from "@/domain/queue-results";
import { sampleWithSeed } from "@/domain/sampling";
import { resolveTimeRange } from "@/domain/time-range";

/** Spans pedidos por traza al comprobar pertenencia al tenant: basta con ver uno del servicio del experimento. */
const TENANT_CHECK_SPANS_PER_TRACE = 20;
/** Tamaño de página al resolver un `fromFilter` (el máximo que admite el listado de trazas). */
const FILTER_PAGE_SIZE = 200;
const MAX_LIST_ITEMS = 500;
/** Candidatos que se leen de un filtro para muestrearlos (solo ids). Si hay más, la muestra sale de los más recientes y se avisa. */
const SAMPLE_POOL_LIMIT = 5000;

export interface QueueActor {
  userId: string;
  experimentId: string;
  /** clave de tenant de ClickHouse */
  serviceName: string;
}

export interface SampleRequest {
  size: number;
  seed?: string;
}

export interface TraceFilter {
  from?: Date;
  to?: Date;
  status?: "ok" | "error";
  hasErrors?: boolean;
  minDurationMs?: number;
  conversationId?: string;
}

/** Qué añadir: exactamente una de las cuatro formas. `limit` y `sample` de un filtro son excluyentes. */
export type AddItemsInput =
  | { traceIds: string[] }
  | { fromFilter: TraceFilter & { limit?: number; sample?: SampleRequest } }
  | { fromRun: { datasetRunId: string; sample?: SampleRequest } }
  | { runItems: Array<{ datasetRunId: string; itemIndex: number }> };

/** Resultado de añadir; `sample` solo si hubo muestreo. */
export interface AddItemsResult {
  added: number;
  duplicates: number;
  sample?: { seed: string; size: number; poolSize: number; truncated: boolean };
}

interface ResolvedTargets {
  targets: QueueTarget[];
  provenance: QueueProvenance;
  sample?: AddItemsResult["sample"];
}

/** Quién puede anotar en la cola, con lo mínimo para pintarlo (nombre y foto; nunca el email). */
export interface AssignedReviewer {
  userId: string;
  name: string | null;
  image: string | null;
}

export interface QueueListItem extends QueueWithProgress {
  assignedReviewers: AssignedReviewer[];
  /** ¿puede el usuario que consulta anotar en esta cola? (ADR-051) */
  isReviewer: boolean;
}

export interface QueueDetail {
  queue: AnnotationQueue;
  /** configs de la rúbrica, en el orden de la rúbrica (incluye archivadas: la UI las marca) */
  configs: ScoreConfig[];
  progress: QueueProgress;
  reviewers: Array<ReviewerProgress & { name: string | null }>;
}

export interface QueueResultsQuery {
  status?: QueueItemStatus;
  /** solo items donde los revisores discrepan en algún criterio (con o sin resolución) */
  onlyDisagreements?: boolean;
  limit?: number;
  offset?: number;
}

export interface ResultLabelWithAuthor extends ResultLabel {
  name: string | null;
  /** false si la persona ya no está en la lista de revisores (sus etiquetas se conservan, ADR-051) */
  isReviewer: boolean;
}

export interface ResultCriterion {
  configId: string;
  status: CriterionStatus;
  labels: ResultLabelWithAuthor[];
  resolution: QueueResolution | null;
}

export interface QueueResultItem {
  item: QueueItem;
  criteria: ResultCriterion[];
  /** algún criterio con desacuerdo y sin resolución del técnico */
  needsResolution: boolean;
  /** datasets (última versión) que ya contienen un item promovido desde esta traza */
  promotedTo: PromotedTraceLocation[];
}

export interface QueueResults {
  /** rúbrica de la cola, para las columnas */
  configs: ScoreConfig[];
  /** items que cumplen el filtro, antes de paginar */
  total: number;
  items: QueueResultItem[];
}

export interface ResolutionInput {
  configId: string;
  value: AnnotationValue;
  expectedOutput?: string | null;
}

const RESULTS_PAGE_DEFAULT = 50;
const RESULTS_PAGE_MAX = 200;

/**
 * Colas de anotación (ADR-039): estado del flujo de trabajo en PostgreSQL, etiquetas en ClickHouse. La
 * autorización de rol la decide el llamador; aquí se comprueba lo que depende de los datos.
 */
export class AnnotationQueueService {
  constructor(
    private readonly queues: AnnotationQueueRepository,
    private readonly scoreConfigs: ScoreConfigRepository,
    private readonly annotations: AnnotationRepository,
    private readonly traces: TraceRepository,
    private readonly identity: Pick<IdentityRepository, "getUsersByIds" | "findPromotedTraces" | "listRunsForExperiment" | "listExperimentMembers" | "getExperiment" | "listOrgMembers">,
    private readonly now: () => Date = () => new Date(),
    private readonly newSeed: () => string = () => randomUUID(),
  ) {}

  async list(experimentId: string, userId: string, includeArchived = false): Promise<QueueListItem[]> {
    const listed = await this.queues.list(experimentId, includeArchived);
    const users = new Map((await this.identity.getUsersByIds([...new Set(listed.flatMap((l) => l.queue.reviewerIds))])).map((u) => [u.id, u]));
    return listed.map((l) => ({
      ...l,
      isReviewer: l.queue.reviewerIds.includes(userId),
      assignedReviewers: l.queue.reviewerIds.map((userId) => ({ userId, name: users.get(userId)?.name ?? null, image: users.get(userId)?.image ?? null })),
    }));
  }

  /**
   * Quién puede ser revisor (ADR-051/ADR-052): los miembros del experimento. Un org_admin no figura: su rol gestiona
   * personas y claves, no da permiso de anotar; si también trabaja aquí, tiene su propia membership.
   */
  async reviewerCandidates(experimentId: string): Promise<Member[]> {
    return [...(await this.identity.listExperimentMembers(experimentId))].sort((a, b) => a.email.localeCompare(b.email));
  }

  async create(experimentId: string, userId: string, input: NewAnnotationQueue): Promise<AnnotationQueue> {
    const valid = validateNewQueue(input);
    await this.requireLiveConfigs(experimentId, valid.rubric.map((r) => r.configId));
    await this.requireExperimentMembers(experimentId, valid.reviewerIds);
    return this.queues.create(experimentId, userId, valid);
  }

  async update(experimentId: string, queueId: string, patch: AnnotationQueuePatch): Promise<AnnotationQueue> {
    const current = await this.requireQueue(experimentId, queueId);
    const next = patch.name !== undefined || patch.requiredAnnotations !== undefined || patch.rubric || patch.reviewerIds
      ? validateNewQueue({
          name: patch.name ?? current.name,
          instructions: patch.instructions === undefined ? current.instructions : patch.instructions,
          requiredAnnotations: patch.requiredAnnotations ?? current.requiredAnnotations,
          reviewerIds: patch.reviewerIds ?? current.reviewerIds,
          rubric: patch.rubric ?? current.rubric.map((r) => ({ configId: r.configId, required: r.required })),
        })
      : null;
    if (patch.rubric) {
      const known = new Set(current.rubric.map((r) => r.configId));
      await this.requireLiveConfigs(experimentId, patch.rubric.map((r) => r.configId).filter((id) => !known.has(id)));
    }
    if (patch.reviewerIds) {
      const known = new Set(current.reviewerIds);
      await this.requireExperimentMembers(experimentId, patch.reviewerIds.filter((id) => !known.has(id)));
    }
    const updated = await this.queues.update(experimentId, queueId, {
      ...patch,
      ...(next ? { name: next.name, instructions: next.instructions } : {}),
    });
    if (!updated) throw new AnnotationQueueNotFoundError(queueId);
    return updated;
  }

  async getDetail(experimentId: string, queueId: string): Promise<QueueDetail> {
    const queue = await this.requireQueue(experimentId, queueId);
    const [progress, reviewers, configs] = await Promise.all([
      this.queues.progress(queueId),
      this.queues.reviewers(queueId),
      this.rubricConfigs(queue),
    ]);
    const users = await this.identity.getUsersByIds(reviewers.map((r) => r.userId));
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { queue, configs, progress, reviewers: reviewers.map((r) => ({ ...r, name: names.get(r.userId) ?? null })) };
  }

  async listItems(experimentId: string, queueId: string, status?: QueueItemStatus, limit = MAX_LIST_ITEMS): Promise<QueueItem[]> {
    await this.requireQueue(experimentId, queueId);
    return this.queues.listItems(queueId, status, Math.min(Math.max(limit, 1), MAX_LIST_ITEMS));
  }

  /**
   * Lo que cada revisor respondió en cada item, con los desacuerdos y las resoluciones del técnico (ADR-050). Es la
   * única lectura que cruza los dos almacenes: ids y resoluciones de PostgreSQL, y todas las etiquetas de la página
   * en UNA consulta a ClickHouse. Se filtra y pagina aquí porque "desacuerdo" depende de las etiquetas.
   */
  async getResults(actor: QueueActor, queueId: string, query: QueueResultsQuery = {}): Promise<QueueResults> {
    const queue = await this.requireQueue(actor.experimentId, queueId);
    const [configs, items] = await Promise.all([this.rubricConfigs(queue), this.queues.listItems(queue.id, query.status, MAX_LIST_ITEMS)]);
    const rubricIds = new Set(queue.rubric.map((r) => r.configId));
    const dataTypes = new Map(configs.map((c) => [c.id, c.dataType]));

    const traceIds = [...new Set(items.filter((i) => i.targetType === "trace" && i.traceId).map((i) => i.traceId!))];
    const runIds = [...new Set(items.filter((i) => i.targetType === "run_item" && i.datasetRunId).map((i) => i.datasetRunId!))];
    const [traceLabels, runLabels, resolutions] = await Promise.all([
      traceIds.length ? this.annotations.listForTraces(tenantOf(actor), traceIds) : [],
      runIds.length ? this.annotations.listForRuns(tenantOf(actor), runIds) : [],
      this.queues.listResolutions(queue.id, items.map((i) => i.id)),
    ]);
    const promoted = await this.identity.findPromotedTraces(actor.experimentId, traceIds);
    const users = new Map((await this.identity.getUsersByIds([...new Set([...traceLabels, ...runLabels].map((a) => a.annotatorId))])).map((u) => [u.id, u.name]));
    const reviewerIds = new Set(queue.reviewerIds);

    const labelsFor = (item: QueueItem, configId: string): ResultLabelWithAuthor[] => {
      const source = item.targetType === "trace"
        ? traceLabels.filter((a) => a.traceId === item.traceId)
        : runLabels.filter((a) => a.datasetRunId === item.datasetRunId && a.itemIndex === item.itemIndex);
      return source
        .filter((a) => a.configId === configId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((a) => ({ userId: a.annotatorId, value: a.value, comment: a.comment, createdAt: a.createdAt, name: users.get(a.annotatorId) ?? null, isReviewer: reviewerIds.has(a.annotatorId) }));
    };

    const rows: QueueResultItem[] = items.map((item) => {
      const criteria: ResultCriterion[] = [...queue.rubric]
        .sort((a, b) => a.position - b.position)
        .filter((r) => rubricIds.has(r.configId) && dataTypes.has(r.configId))
        .map((r) => {
          const labels = labelsFor(item, r.configId);
          const resolution = resolutions.find((x) => x.queueItemId === item.id && x.configId === r.configId) ?? null;
          return { configId: r.configId, status: criterionStatus(dataTypes.get(r.configId)!, labels), labels, resolution };
        });
      return {
        item,
        criteria,
        needsResolution: criteria.some((c) => c.status === "disagreement" && !c.resolution),
        promotedTo: item.traceId ? promoted.filter((p) => p.traceId === item.traceId) : [],
      };
    });

    const filtered = query.onlyDisagreements ? rows.filter((r) => r.criteria.some((c) => c.status === "disagreement")) : rows;
    const limit = Math.min(Math.max(query.limit ?? RESULTS_PAGE_DEFAULT, 1), RESULTS_PAGE_MAX);
    const offset = Math.max(query.offset ?? 0, 0);
    return { configs, total: filtered.length, items: filtered.slice(offset, offset + limit) };
  }

  /** Colas del experimento que contienen la traza, para mostrarlo en su detalle (ADR-050). Cualquier miembro. */
  async queuesForTrace(experimentId: string, traceId: string): Promise<TraceQueueMembership[]> {
    return this.queues.listQueuesForTrace(experimentId, traceId);
  }

  /** El técnico fija el valor final (y opcionalmente la respuesta correcta) de un criterio. No toca las etiquetas de los revisores. */
  async resolve(experimentId: string, userId: string, queueId: string, itemId: string, input: ResolutionInput): Promise<QueueResolution> {
    const queue = await this.requireQueue(experimentId, queueId);
    const item = await this.requireItem(queue.id, itemId);
    if (!queue.rubric.some((r) => r.configId === input.configId)) {
      throw new ValidationError("Invalid resolution", { configId: "is not part of this queue's rubric" });
    }
    const config = (await this.rubricConfigs(queue)).find((c) => c.id === input.configId);
    if (!config) throw new ScoreConfigNotFoundError(input.configId);
    if (config.archivedAt) throw new ValidationError("Invalid resolution", { configId: `${config.name} is archived` });
    return this.queues.upsertResolution(queue.id, {
      queueItemId: item.id,
      configId: config.id,
      value: validateAnnotationValue(config, input.value),
      expectedOutput: input.expectedOutput?.trim() || null,
      resolvedBy: userId,
    });
  }

  async clearResolution(experimentId: string, queueId: string, itemId: string, configId: string): Promise<void> {
    const queue = await this.requireQueue(experimentId, queueId);
    const item = await this.requireItem(queue.id, itemId);
    if (!(await this.queues.deleteResolution(queue.id, item.id, configId))) throw new AnnotationQueueNotFoundError(queue.id, item.id);
  }

  /** Resuelve a objetivos concretos, los verifica contra el tenant y los añade. Los duplicados se descartan. */
  async addItems(actor: QueueActor, queueId: string, input: AddItemsInput): Promise<AddItemsResult> {
    const queue = await this.requireOpenQueue(actor.experimentId, queueId);
    const { targets, provenance, sample } = await this.resolveTargets(actor, input);
    const { added, duplicates } = await this.queues.addItems(queue.id, actor.userId, targets, provenance);
    return { added, duplicates, ...(sample ? { sample } : {}) };
  }

  /** El siguiente item para este revisor (o el que ya tenía abierto). null si la cola no tiene más para él. */
  async next(actor: QueueActor, queueId: string): Promise<QueueItem | null> {
    const queue = this.requireReviewer(await this.requireOpenQueue(actor.experimentId, queueId), actor.userId);
    return this.queues.claimNext(queue, actor.userId);
  }

  /**
   * Orden fijo (ADR-039): validar contra la rúbrica -> escribir etiquetas en ClickHouse -> completar el claim
   * en PostgreSQL. Si falla el último paso, reintentar la misma petición es idempotente (mismas claves en
   * ClickHouse); lo único que puede quedar es un item "aún no terminado", nunca uno terminado sin etiquetas.
   */
  async complete(actor: QueueActor, queueId: string, itemId: string, labels: QueueLabel[]): Promise<QueueItem> {
    const queue = this.requireReviewer(await this.requireOpenQueue(actor.experimentId, queueId), actor.userId);
    const item = await this.requireItem(queue.id, itemId);
    if (item.status === "skipped") throw new AnnotationQueueInvariantError("This item was marked as unreviewable");
    if (!(await this.queues.hasClaim(item.id, actor.userId))) {
      throw new AnnotationQueueInvariantError("Pull this item with `next` before completing it");
    }
    const checked = validateQueueLabels(queue, await this.rubricConfigs(queue), labels);

    const createdAt = this.now().toISOString();
    for (const { config, value, comment } of checked) {
      const annotation: Annotation = {
        traceId: item.traceId ?? "",
        spanId: null,
        configId: config.id,
        configName: config.name,
        dataType: config.dataType,
        annotatorId: actor.userId,
        value,
        comment,
        createdAt,
        ...(item.targetType === "run_item" ? { datasetRunId: item.datasetRunId, itemIndex: item.itemIndex } : {}),
      };
      await this.annotations.upsert(tenantOf(actor), annotation);
    }
    return this.queues.completeClaim(queue, item.id, actor.userId);
  }

  /** El revisor pasa de este item; vuelve al pool para los demás. */
  async skip(actor: QueueActor, queueId: string, itemId: string): Promise<QueueItem> {
    const queue = this.requireReviewer(await this.requireOpenQueue(actor.experimentId, queueId), actor.userId);
    const item = await this.requireItem(queue.id, itemId);
    if (!(await this.queues.hasClaim(item.id, actor.userId))) {
      throw new AnnotationQueueInvariantError("Pull this item with `next` before skipping it");
    }
    return this.queues.skipClaim(queue, item.id, actor.userId);
  }

  /** Acción de admin: el item deja de repartirse. */
  async markUnreviewable(experimentId: string, queueId: string, itemId: string): Promise<QueueItem> {
    const queue = await this.requireQueue(experimentId, queueId);
    const item = await this.queues.markUnreviewable(queue.id, itemId);
    if (!item) throw new AnnotationQueueNotFoundError(queueId, itemId);
    return item;
  }

  private async resolveTargets(actor: QueueActor, input: AddItemsInput): Promise<ResolvedTargets> {
    if ("traceIds" in input) return { targets: await this.verifyTraces(actor, input.traceIds), provenance: { population: "manual", seed: null } };
    if ("fromFilter" in input) return this.resolveFilterTargets(actor, input.fromFilter);
    if ("fromRun" in input) return this.resolveRunTargets(actor, input.fromRun);
    return { targets: await this.verifyRunItems(actor, input.runItems), provenance: { population: "manual", seed: null } };
  }

  private async resolveFilterTargets(actor: QueueActor, filter: TraceFilter & { limit?: number; sample?: SampleRequest }): Promise<ResolvedTargets> {
    if ((filter.limit === undefined) === (filter.sample === undefined)) {
      throw new ValidationError("Invalid filter", { fromFilter: "exactly one of limit or sample is required" });
    }
    if (!filter.sample) {
      const { ids } = await this.resolveFilter(actor, filter, Math.min(Math.max(Math.trunc(filter.limit ?? 0), 1), MAX_ITEMS_PER_REQUEST));
      return { targets: await this.verifyTraces(actor, ids), provenance: { population: "filter", seed: null } };
    }
    const size = this.validSampleSize(filter.sample);
    const { ids, truncated } = await this.resolveFilter(actor, filter, SAMPLE_POOL_LIMIT);
    const seed = filter.sample.seed ?? this.newSeed();
    const chosen = sampleWithSeed(ids, size, seed);
    return {
      targets: await this.verifyTraces(actor, chosen),
      provenance: { population: "random_sample", seed },
      sample: { seed, size: chosen.length, poolSize: ids.length, truncated },
    };
  }

  /** Items de un run: todos (hasta el tope de una petición) o una muestra aleatoria, elegida aquí para que funcione en runs de miles de items. */
  private async resolveRunTargets(actor: QueueActor, from: { datasetRunId: string; sample?: SampleRequest }): Promise<ResolvedTargets> {
    const run = (await this.identity.listRunsForExperiment(actor.experimentId)).find((r) => r.id === from.datasetRunId);
    if (!run) throw new ValidationError("Unknown run", { fromRun: `run not found in this experiment: ${from.datasetRunId}` });
    const indexes = Array.from({ length: run.itemCount }, (_, i) => i);
    if (!from.sample) {
      if (indexes.length > MAX_ITEMS_PER_REQUEST) {
        throw new ValidationError("Too many items", { fromRun: `the run has ${indexes.length} items; send a random sample of at most ${MAX_ITEMS_PER_REQUEST} instead` });
      }
      const items = indexes.map((itemIndex) => ({ datasetRunId: run.id, itemIndex }));
      return { targets: await this.verifyRunItems(actor, items), provenance: { population: "filter", seed: null } };
    }
    const size = this.validSampleSize(from.sample);
    const seed = from.sample.seed ?? this.newSeed();
    const chosen = sampleWithSeed(indexes, size, seed).map((itemIndex) => ({ datasetRunId: run.id, itemIndex }));
    return {
      targets: await this.verifyRunItems(actor, chosen),
      provenance: { population: "random_sample", seed },
      sample: { seed, size: chosen.length, poolSize: indexes.length, truncated: false },
    };
  }

  private validSampleSize(sample: SampleRequest): number {
    if (!Number.isInteger(sample.size) || sample.size < 1 || sample.size > MAX_ITEMS_PER_REQUEST) {
      throw new ValidationError("Invalid sample", { sample: `size must be between 1 and ${MAX_ITEMS_PER_REQUEST}` });
    }
    return sample.size;
  }

  private async verifyTraces(actor: QueueActor, ids: string[]): Promise<QueueTarget[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new ValidationError("Nothing to add", { traceIds: "must include at least one trace id" });
    if (unique.length > MAX_ITEMS_PER_REQUEST) throw new ValidationError("Too many items", { traceIds: `at most ${MAX_ITEMS_PER_REQUEST} per request` });
    // una sola consulta para todas; una traza de otro tenant se trata igual que una inexistente
    const found = await this.traces.getTraceSpansForTraces(tenantOf(actor), unique, TENANT_CHECK_SPANS_PER_TRACE);
    const unknown = unique.filter((id) => !found.get(id)?.spans.some((s) => s.serviceName === actor.serviceName));
    if (unknown.length > 0) throw new ValidationError("Unknown traces", { traceIds: `not found in this experiment: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}` });
    return unique.map((traceId) => ({ targetType: "trace", traceId }));
  }

  /** Instantánea de las trazas que cumplen el filtro *ahora*: la cola guarda ids, no es una búsqueda viva. */
  private async resolveFilter(actor: QueueActor, filter: TraceFilter, limit: number): Promise<{ ids: string[]; truncated: boolean }> {
    const range = resolveTimeRange(filter, this.now().getTime());
    const ids: string[] = [];
    let cursor;
    while (ids.length < limit) {
      const page = await this.traces.listTraces({
        ...range,
        scope: tenantOf(actor),
        status: filter.status,
        hasErrors: filter.hasErrors,
        minDurationMs: filter.minDurationMs,
        conversationId: filter.conversationId,
        limit: Math.min(FILTER_PAGE_SIZE, limit - ids.length),
        cursor,
      });
      ids.push(...page.items.map((t) => t.traceId));
      if (!page.nextCursor || page.items.length === 0) return { ids, truncated: false };
      cursor = page.nextCursor;
    }
    // salió del bucle por llenar el tope con páginas aún por leer: hay más candidatos de los que se leyeron
    return { ids, truncated: true };
  }

  private async verifyRunItems(actor: QueueActor, items: Array<{ datasetRunId: string; itemIndex: number }>): Promise<QueueTarget[]> {
    if (items.length === 0) throw new ValidationError("Nothing to add", { runItems: "must include at least one item" });
    if (items.length > MAX_ITEMS_PER_REQUEST) throw new ValidationError("Too many items", { runItems: `at most ${MAX_ITEMS_PER_REQUEST} per request` });
    const runs = new Map((await this.identity.listRunsForExperiment(actor.experimentId)).map((r) => [r.id, r]));
    const invalid = items.filter((i) => {
      const run = runs.get(i.datasetRunId);
      return !run || i.itemIndex < 0 || i.itemIndex >= run.itemCount;
    });
    if (invalid.length > 0) {
      throw new ValidationError("Unknown run items", { runItems: `not found in this experiment: ${invalid.slice(0, 5).map((i) => `${i.datasetRunId}#${i.itemIndex}`).join(", ")}` });
    }
    return items.map((i) => ({ targetType: "run_item", datasetRunId: i.datasetRunId, itemIndex: i.itemIndex }));
  }

  private async requireQueue(experimentId: string, queueId: string): Promise<AnnotationQueue> {
    const queue = await this.queues.get(experimentId, queueId);
    if (!queue) throw new AnnotationQueueNotFoundError(queueId);
    return queue;
  }

  private async requireOpenQueue(experimentId: string, queueId: string): Promise<AnnotationQueue> {
    const queue = await this.requireQueue(experimentId, queueId);
    if (queue.archivedAt) throw new AnnotationQueueInvariantError("This queue is archived");
    return queue;
  }

  /** Solo las personas de la lista (ADR-051) reclaman, completan o saltan items; ni siquiera un admin si no está en ella. */
  private requireReviewer(queue: AnnotationQueue, userId: string): AnnotationQueue {
    if (!queue.reviewerIds.includes(userId)) throw new AnnotationQueueReviewerError(queue.id);
    return queue;
  }

  /** Los revisores deben tener ya acceso al experimento (miembro del experimento): una cola no abre el acceso a quien no lo tenía. */
  private async requireExperimentMembers(experimentId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const members = new Set((await this.reviewerCandidates(experimentId)).map((m) => m.userId));
    const outsiders = userIds.filter((id) => !members.has(id));
    if (outsiders.length > 0) throw new ValidationError("Invalid reviewers", { reviewerIds: `not members of this experiment: ${outsiders.join(", ")}` });
  }

  private async requireItem(queueId: string, itemId: string): Promise<QueueItem> {
    const item = await this.queues.getItem(queueId, itemId);
    if (!item) throw new AnnotationQueueNotFoundError(queueId, itemId);
    return item;
  }

  /** Las configs deben existir en el experimento y estar vivas para entrar en una rúbrica. */
  private async requireLiveConfigs(experimentId: string, configIds: string[]): Promise<void> {
    for (const id of configIds) {
      const config = await this.scoreConfigs.get(experimentId, id);
      if (!config) throw new ScoreConfigNotFoundError(id);
      if (config.archivedAt) throw new AnnotationQueueInvariantError(`Score config "${config.name}" is archived`);
    }
  }

  private async rubricConfigs(queue: AnnotationQueue): Promise<ScoreConfig[]> {
    const found = await Promise.all([...queue.rubric].sort((a, b) => a.position - b.position).map((r) => this.scoreConfigs.get(queue.experimentId, r.configId)));
    return found.filter((c): c is ScoreConfig => c !== null);
  }
}
