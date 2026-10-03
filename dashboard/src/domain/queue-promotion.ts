import type { PromoteTracesBody, PromotionSkipReasonDto, QueueItemDto } from "@contract";

/** El servidor acepta como máximo 100 trazas por llamada (ADR-038); cada llamada crea UNA versión major. */
export const PROMOTE_BATCH_SIZE = 100;

/** Trazas de una cola que se pueden promover: items de tipo traza ya revisados, sin repetir. */
export function promotableTraceIds(items: QueueItemDto[]): string[] {
  return [...new Set(items.filter((i) => i.targetType === "trace" && i.status === "completed" && i.traceId).map((i) => i.traceId!))];
}

/** Trozos de tamaño `PROMOTE_BATCH_SIZE` listos para enviar a `from-traces`. */
export function promotionBatches(traceIds: string[], fromConfigId?: string): PromoteTracesBody[] {
  const batches: PromoteTracesBody[] = [];
  for (let i = 0; i < traceIds.length; i += PROMOTE_BATCH_SIZE) {
    batches.push({ items: traceIds.slice(i, i + PROMOTE_BATCH_SIZE).map((traceId) => ({ traceId, ...(fromConfigId ? { fromConfigId } : {}) })) });
  }
  return batches;
}

/** Cuenta los motivos de omisión para resumirlos en un aviso. */
export function countSkipReasons(skipped: Array<{ reason: PromotionSkipReasonDto }>): Partial<Record<PromotionSkipReasonDto, number>> {
  const counts: Partial<Record<PromotionSkipReasonDto, number>> = {};
  for (const s of skipped) counts[s.reason] = (counts[s.reason] ?? 0) + 1;
  return counts;
}
