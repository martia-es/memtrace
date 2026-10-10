import { ValidationError } from "./errors";

/** Retención de trazas (ADR-080). Un valor por organización y, opcionalmente, uno más corto por experimento. */
export const MIN_RETENTION_DAYS = 1;
/** Techo: el TTL de las tablas de trazas en ClickHouse (migración 013). Subirlo exige migrar ese TTL. */
export const MAX_RETENTION_DAYS = 365;
export const DEFAULT_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

/** Un número entero de días dentro de rango, o un `ValidationError` que dice qué campo falla. */
export function validateRetentionDays(value: unknown, field = "days"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_RETENTION_DAYS || value > MAX_RETENTION_DAYS) {
    throw new ValidationError("Invalid retention", { [field]: `Must be a whole number of days from ${MIN_RETENTION_DAYS} to ${MAX_RETENTION_DAYS}` });
  }
  return value;
}

/** Plazo que se aplica de verdad: el override, si existe, nunca puede alargar el de la organización. */
export function effectiveRetentionDays(organizationDays: number, overrideDays: number | null): number {
  return overrideDays === null ? organizationDays : Math.min(organizationDays, overrideDays);
}

/** Todo lo anterior a este instante se borra. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export interface ExperimentRetention {
  experimentId: string;
  name: string;
  serviceName: string;
  /** NULL = sin override: vale el de la organización */
  overrideDays: number | null;
  effectiveDays: number;
}

export interface RetentionPolicy {
  organizationId: string;
  defaultDays: number;
  minDays: number;
  maxDays: number;
  experiments: ExperimentRetention[];
}

/** Un experimento que el worker de purga debe revisar. */
export interface PurgeTarget {
  organizationId: string;
  experimentId: string;
  serviceName: string;
  days: number;
}
