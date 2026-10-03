import type { AnnotationQueueRepository, QueueWithProgress } from "@/application/ports/annotation-queue-repository";
import type { AnnotationRepository } from "@/application/ports/annotation-repository";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { TraceRepository } from "@/application/ports/trace-repository";
import type { Annotation } from "@/domain/annotation";
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
import { AnnotationQueueInvariantError, AnnotationQueueNotFoundError, ScoreConfigNotFoundError, ValidationError } from "@/domain/errors";
import type { ScoreConfig } from "@/domain/score-config";
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

export interface QueueDetail {
  queue: AnnotationQueue;
  /** configs de la rúbrica, en el orden de la rúbrica (incluye archivadas: la UI las marca) */
  configs: ScoreConfig[];
  progress: QueueProgress;
  reviewers: Array<ReviewerProgress & { name: string | null }>;
}

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
    private readonly identity: Pick<IdentityRepository, "getUsersByIds" | "listRunsForExperiment">,
    private readonly now: () => Date = () => new Date(),
    private readonly newSeed: () => string = () => randomUUID(),
  ) {}

  list(experimentId: string, includeArchived = false): Promise<QueueWithProgress[]> {
    return this.queues.list(experimentId, includeArchived);
  }

  async create(experimentId: string, userId: string, input: NewAnnotationQueue): Promise<AnnotationQueue> {
    const valid = validateNewQueue(input);
    await this.requireLiveConfigs(experimentId, valid.rubric.map((r) => r.configId));
    return this.queues.create(experimentId, userId, valid);
  }

  async update(experimentId: string, queueId: string, patch: AnnotationQueuePatch): Promise<AnnotationQueue> {
    const current = await this.requireQueue(experimentId, queueId);
    const next = patch.name !== undefined || patch.requiredAnnotations !== undefined || patch.rubric
      ? validateNewQueue({
          name: patch.name ?? current.name,
          instructions: patch.instructions === undefined ? current.instructions : patch.instructions,
          requiredAnnotations: patch.requiredAnnotations ?? current.requiredAnnotations,
          rubric: patch.rubric ?? current.rubric.map((r) => ({ configId: r.configId, required: r.required })),
        })
      : null;
    if (patch.rubric) {
      const known = new Set(current.rubric.map((r) => r.configId));
      await this.requireLiveConfigs(experimentId, patch.rubric.map((r) => r.configId).filter((id) => !known.has(id)));
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

  /** Resuelve a objetivos concretos, los verifica contra el tenant y los añade. Los duplicados se descartan. */
  async addItems(actor: QueueActor, queueId: string, input: AddItemsInput): Promise<AddItemsResult> {
    const queue = await this.requireOpenQueue(actor.experimentId, queueId);
    const { targets, provenance, sample } = await this.resolveTargets(actor, input);
    const { added, duplicates } = await this.queues.addItems(queue.id, actor.userId, targets, provenance);
    return { added, duplicates, ...(sample ? { sample } : {}) };
  }

  /** El siguiente item para este revisor (o el que ya tenía abierto). null si la cola no tiene más para él. */
  async next(actor: QueueActor, queueId: string): Promise<QueueItem | null> {
    const queue = await this.requireOpenQueue(actor.experimentId, queueId);
    return this.queues.claimNext(queue, actor.userId);
  }

  /**
   * Orden fijo (ADR-039): validar contra la rúbrica -> escribir etiquetas en ClickHouse -> completar el claim
   * en PostgreSQL. Si falla el último paso, reintentar la misma petición es idempotente (mismas claves en
   * ClickHouse); lo único que puede quedar es un item "aún no terminado", nunca uno terminado sin etiquetas.
   */
  async complete(actor: QueueActor, queueId: string, itemId: string, labels: QueueLabel[]): Promise<QueueItem> {
    const queue = await this.requireOpenQueue(actor.experimentId, queueId);
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
      await this.annotations.upsert(actor.serviceName, annotation);
    }
    return this.queues.completeClaim(queue, item.id, actor.userId);
  }

  /** El revisor pasa de este item; vuelve al pool para los demás. */
  async skip(actor: QueueActor, queueId: string, itemId: string): Promise<QueueItem> {
    const queue = await this.requireOpenQueue(actor.experimentId, queueId);
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
    const found = await this.traces.getTraceSpansForTraces(unique, TENANT_CHECK_SPANS_PER_TRACE);
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
        service: actor.serviceName,
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
