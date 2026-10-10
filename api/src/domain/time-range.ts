import { ValidationError } from "./errors";

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

export const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
/** Techo de la retención (ADR-084, TTL de ClickHouse): no tiene sentido consultar más atrás de 365 días. */
export const MAX_RANGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Aplica el rango por defecto (últimas 24 h) y valida `from < to` y el máximo de 365 días. */
export function resolveTimeRange(input: { from?: Date; to?: Date }, nowMs: number): TimeRange {
  const toMs = input.to?.getTime() ?? nowMs;
  const fromMs = input.from?.getTime() ?? toMs - DEFAULT_RANGE_MS;
  if (!(fromMs < toMs)) {
    throw new ValidationError("Invalid time range", { from: "`from` must be earlier than `to`" });
  }
  if (toMs - fromMs > MAX_RANGE_MS) {
    throw new ValidationError("Invalid time range", { from: "the range cannot exceed 365 days" });
  }
  return { fromMs, toMs };
}
