/** Colas de anotación (ADR-039). Lógica pura, sin I/O. */
import { AnnotationQueueInvariantError, ValidationError } from "@/domain/errors";
import { validateAnnotationValue, type AnnotationValue } from "@/domain/annotation";
import type { ScoreConfig } from "@/domain/score-config";

/** Tras este tiempo, un claim sin completar deja de contar y el item vuelve al pool. Constante global, no por cola. */
export const CLAIM_LEASE_MINUTES = 15;
export const MAX_ITEMS_PER_REQUEST = 500;
export const MAX_REQUIRED_ANNOTATIONS = 10;

export type QueueItemStatus = "pending" | "completed" | "skipped";
export type QueueTargetType = "trace" | "run_item";
/** Cómo se eligió un item (ADR-040): a mano, por un filtro o un run completo, o por muestreo aleatorio. */
export type QueuePopulation = "manual" | "filter" | "random_sample";

/** Procedencia de un lote de items. `seed` solo existe en `random_sample`: con ella la muestra se reproduce. */
export interface QueueProvenance {
  population: QueuePopulation;
  seed: string | null;
}

export interface QueueRubricEntry {
  configId: string;
  required: boolean;
  position: number;
}

export interface AnnotationQueue {
  id: string;
  experimentId: string;
  name: string;
  instructions: string | null;
  requiredAnnotations: number;
  rubric: QueueRubricEntry[];
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
}

export interface QueueProgress {
  pending: number;
  completed: number;
  skipped: number;
}

export interface ReviewerProgress {
  userId: string;
  completed: number;
  skipped: number;
  /** claims sin completar ni saltar (incluye los caducados: no hay job que los limpie) */
  inProgress: number;
}

export interface QueueItem {
  id: string;
  queueId: string;
  targetType: QueueTargetType;
  /** null salvo en `trace` */
  traceId: string | null;
  datasetRunId: string | null;
  itemIndex: number | null;
  status: QueueItemStatus;
  population: QueuePopulation;
  sampleSeed: string | null;
  addedBy: string;
  addedAt: string;
  completedAt: string | null;
}

/** Qué se añade a la cola. Los `run_item` identifican el resultado de una run por (run, posición). */
export type QueueTarget =
  | { targetType: "trace"; traceId: string }
  | { targetType: "run_item"; datasetRunId: string; itemIndex: number };

export interface NewAnnotationQueue {
  name: string;
  instructions: string | null;
  requiredAnnotations: number;
  rubric: Array<{ configId: string; required: boolean }>;
}

export interface AnnotationQueuePatch {
  name?: string;
  instructions?: string | null;
  requiredAnnotations?: number;
  /** Rúbrica completa deseada. En una cola con trabajo ya hecho solo puede añadir configs. */
  rubric?: Array<{ configId: string; required: boolean }>;
  archived?: boolean;
}

export interface QueueLabel {
  configId: string;
  value: AnnotationValue;
  comment?: string | null;
}

/**
 * Estado de un item a partir de sus claims. `skipped` lo fija un admin y no se recalcula; el resto es
 * función pura de cuántos revisores han terminado frente a los que pide la cola.
 */
export function deriveItemStatus(current: QueueItemStatus, completedClaims: number, requiredAnnotations: number): QueueItemStatus {
  if (current === "skipped") return "skipped";
  return completedClaims >= requiredAnnotations ? "completed" : "pending";
}

export function validateNewQueue(input: NewAnnotationQueue): NewAnnotationQueue {
  const name = input.name.trim();
  const fields: Record<string, string> = {};
  if (!name) fields.name = "must not be empty";
  if (!Number.isInteger(input.requiredAnnotations) || input.requiredAnnotations < 1 || input.requiredAnnotations > MAX_REQUIRED_ANNOTATIONS) {
    fields.requiredAnnotations = `must be an integer between 1 and ${MAX_REQUIRED_ANNOTATIONS}`;
  }
  if (input.rubric.length === 0) fields.rubric = "must include at least one score config";
  if (new Set(input.rubric.map((r) => r.configId)).size !== input.rubric.length) fields.rubric = "contains the same score config twice";
  if (Object.keys(fields).length > 0) throw new ValidationError("Invalid annotation queue", fields);
  return { ...input, name, instructions: input.instructions?.trim() || null };
}

/** `desired` solo puede añadir configs al `current` (mismo espíritu de compatibilidad que ADR-036). */
export function assertRubricOnlyGrows(current: QueueRubricEntry[], desired: Array<{ configId: string }>): void {
  const desiredIds = new Set(desired.map((r) => r.configId));
  const removed = current.filter((r) => !desiredIds.has(r.configId));
  if (removed.length > 0) throw new AnnotationQueueInvariantError("Score configs cannot be removed from a queue that already has items");
}

/**
 * Comprueba las etiquetas enviadas contra la rúbrica y devuelve (config, valor normalizado, comentario)
 * en orden de rúbrica. Una config archivada deja de ser obligatoria y ya no admite etiquetas.
 * `configs` son las configs de la rúbrica de esa cola.
 */
export function validateQueueLabels(
  queue: Pick<AnnotationQueue, "rubric">,
  configs: ScoreConfig[],
  labels: QueueLabel[],
): Array<{ config: ScoreConfig; value: string; comment: string | null }> {
  const byId = new Map(configs.map((c) => [c.id, c]));
  const inRubric = new Map(queue.rubric.map((r) => [r.configId, r]));
  const submitted = new Map<string, QueueLabel>();
  for (const label of labels) {
    if (!inRubric.has(label.configId)) throw new ValidationError("Invalid labels", { [label.configId]: "is not part of this queue's rubric" });
    if (submitted.has(label.configId)) throw new ValidationError("Invalid labels", { [label.configId]: "was sent twice" });
    submitted.set(label.configId, label);
  }
  const missing = queue.rubric.filter((r) => r.required && !submitted.has(r.configId) && !byId.get(r.configId)?.archivedAt);
  if (missing.length > 0) {
    throw new ValidationError("Missing required labels", Object.fromEntries(missing.map((r) => [r.configId, `${byId.get(r.configId)?.name ?? r.configId} is required`])));
  }
  return [...queue.rubric]
    .sort((a, b) => a.position - b.position)
    .filter((r) => submitted.has(r.configId))
    .map((r) => {
      const config = byId.get(r.configId);
      if (!config) throw new ValidationError("Invalid labels", { [r.configId]: "score config not found" });
      if (config.archivedAt) throw new ValidationError("Invalid labels", { [r.configId]: `${config.name} is archived` });
      const label = submitted.get(r.configId)!;
      return { config, value: validateAnnotationValue(config, label.value), comment: label.comment?.trim() || null };
    });
}
