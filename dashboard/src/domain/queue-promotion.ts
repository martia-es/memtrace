import type { PromoteTracesBody, PromotionSkipReasonDto, QueueResultItemDto, ScoreConfigDto } from "@contract";

/** El servidor acepta como máximo 100 trazas por llamada (ADR-038); cada llamada crea UNA versión major. */
export const PROMOTE_BATCH_SIZE = 100;

/** Por qué una fila de Results no se puede promover todavía (ADR-050). */
export type RowReadiness = "ready" | "needs_resolution" | "not_reviewed" | "not_a_trace";

export function rowReadiness(row: QueueResultItemDto): RowReadiness {
  if (row.targetType !== "trace" || !row.traceId) return "not_a_trace";
  if (row.status !== "completed") return "not_reviewed";
  return row.needsResolution ? "needs_resolution" : "ready";
}

/** Valor final de un criterio: la resolución del técnico o, sin ella, el consenso de los revisores (mediana si es numérico). */
export function finalValue(row: QueueResultItemDto, configId: string, config?: Pick<ScoreConfigDto, "dataType">): string | null {
  const criterion = row.criteria.find((c) => c.configId === configId);
  if (!criterion) return null;
  if (criterion.resolution) return criterion.resolution.value;
  if (criterion.status !== "consensus") return null;
  if (config?.dataType !== "numeric") return criterion.labels[0]!.value;
  const sorted = criterion.labels.map((l) => Number(l.value)).sort((a, b) => a - b);
  return String(sorted[Math.floor(sorted.length / 2)]);
}

/**
 * Respuesta correcta que se copia al item del dataset: la que escribió el técnico al resolver; si no hay, el valor final
 * de la config categórica elegida como referencia; si tampoco, ninguna (el item queda sin expected output, ADR-038).
 */
export function expectedOutputFor(row: QueueResultItemDto, reference?: Pick<ScoreConfigDto, "id" | "dataType">): string | undefined {
  const typed = row.criteria.find((c) => c.resolution?.expectedOutput)?.resolution?.expectedOutput;
  if (typed) return typed;
  if (!reference || reference.dataType !== "categorical") return undefined;
  return finalValue(row, reference.id, reference) ?? undefined;
}

/** Cuerpos para `from-traces`: solo las filas listas, en tandas de `PROMOTE_BATCH_SIZE`. `queueId` deja la cola de origen en `promotedFrom`. */
export function promotionBatches(rows: QueueResultItemDto[], reference?: Pick<ScoreConfigDto, "id" | "dataType">, queueId?: string): PromoteTracesBody[] {
  const items = [...new Map(rows.filter((r) => rowReadiness(r) === "ready").map((r) => [r.traceId!, r])).values()].map((r) => {
    const expectedOutput = expectedOutputFor(r, reference);
    return { traceId: r.traceId!, ...(expectedOutput !== undefined ? { expectedOutput } : {}), ...(queueId ? { queueId } : {}) };
  });
  const batches: PromoteTracesBody[] = [];
  for (let i = 0; i < items.length; i += PROMOTE_BATCH_SIZE) batches.push({ items: items.slice(i, i + PROMOTE_BATCH_SIZE) });
  return batches;
}

/** Cuenta los motivos de omisión para resumirlos en un aviso. */
export function countSkipReasons(skipped: Array<{ reason: PromotionSkipReasonDto }>): Partial<Record<PromotionSkipReasonDto, number>> {
  const counts: Partial<Record<PromotionSkipReasonDto, number>> = {};
  for (const s of skipped) counts[s.reason] = (counts[s.reason] ?? 0) + 1;
  return counts;
}
