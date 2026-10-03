import type {
  AnnotationQueue,
  AnnotationQueuePatch,
  NewAnnotationQueue,
  QueueItem,
  QueueItemStatus,
  QueueProgress,
  QueueProvenance,
  QueueTarget,
  ReviewerProgress,
} from "@/domain/annotation-queue";

export interface QueueWithProgress {
  queue: AnnotationQueue;
  progress: QueueProgress;
}

export interface AddedItems {
  added: number;
  /** ya estaban en la cola */
  duplicates: number;
}

/**
 * Almacén de colas de anotación (ADR-039). PostgreSQL: estado transaccional pequeño (items, claims).
 * Las etiquetas no pasan por aquí, van a ClickHouse (`AnnotationRepository`).
 */
export interface AnnotationQueueRepository {
  list(experimentId: string, includeArchived: boolean): Promise<QueueWithProgress[]>;
  get(experimentId: string, queueId: string): Promise<AnnotationQueue | null>;
  progress(queueId: string): Promise<QueueProgress>;
  reviewers(queueId: string): Promise<ReviewerProgress[]>;
  /** Lanza `AnnotationQueueInvariantError` si ya hay una cola activa con ese nombre. */
  create(experimentId: string, createdByUserId: string, input: NewAnnotationQueue): Promise<AnnotationQueue>;
  /**
   * Aplica el parche y, si cambia `requiredAnnotations`, recalcula el estado de todos los items en una sola
   * sentencia. Devuelve null si la cola no existe. Lanza `AnnotationQueueInvariantError` si el nombre está
   * ocupado o se quita una config de una cola con items.
   */
  update(experimentId: string, queueId: string, patch: AnnotationQueuePatch): Promise<AnnotationQueue | null>;

  /** Ignora los objetivos que ya están en la cola (conservan su procedencia original). Sin `provenance`, `manual`. */
  addItems(queueId: string, addedBy: string, targets: QueueTarget[], provenance?: QueueProvenance): Promise<AddedItems>;
  listItems(queueId: string, status: QueueItemStatus | undefined, limit: number): Promise<QueueItem[]>;
  getItem(queueId: string, itemId: string): Promise<QueueItem | null>;

  /**
   * Devuelve el item que el usuario ya tenía sin terminar (reanudar) o reclama el siguiente libre; null si no
   * queda ninguno para él. Todo en una transacción con `FOR UPDATE SKIP LOCKED`: dos llamadas simultáneas
   * nunca reciben el mismo item de más.
   */
  claimNext(queue: AnnotationQueue, userId: string): Promise<QueueItem | null>;
  /** true si el usuario tiene una fila de claim (terminada o no) sobre el item. */
  hasClaim(itemId: string, userId: string): Promise<boolean>;
  /** Marca el claim como completado (idempotente) y recalcula el estado del item. Devuelve el item resultante. */
  completeClaim(queue: AnnotationQueue, itemId: string, userId: string): Promise<QueueItem>;
  /** Marca el claim como saltado; el item vuelve al pool para los demás. */
  skipClaim(queue: AnnotationQueue, itemId: string, userId: string): Promise<QueueItem>;
  /** Acción de admin: el item pasa a `skipped` y deja de repartirse. */
  markUnreviewable(queueId: string, itemId: string): Promise<QueueItem | null>;
}
