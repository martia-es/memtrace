import { ValidationError } from "./errors";
import type { RiskLevel } from "./risk";

/**
 * Retención de trazas (ADR-084, ampliado por ADR-102). Un plazo por nivel de riesgo y organización: la retención de un agente es
 * la de su nivel. Es el único sitio donde se configura.
 */
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

/** Todo lo anterior a este instante se borra. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Nivel para la retención: los agentes sin clasificar tienen el suyo (ADR-102). */
export type RetentionLevel = "unclassified" | RiskLevel;
/** De más a menos riesgo, que es como se muestran. */
export const RETENTION_LEVELS: readonly RetentionLevel[] = ["high", "limited", "minimal", "unclassified"];

/**
 * Suelo del AI Act (art. 26.6: registros conservados al menos seis meses) para los agentes de alto riesgo. Los sin clasificar
 * tienen el mismo: purgar antes de que alguien los clasifique perdería registros que no se pueden recuperar (ADR-102).
 */
export const AI_ACT_MIN_RETENTION_DAYS = 180;

export function isRetentionLevel(value: string): value is RetentionLevel {
  return (RETENTION_LEVELS as readonly string[]).includes(value);
}

export function retentionLevelOf(risk: RiskLevel | null): RetentionLevel {
  return risk ?? "unclassified";
}

/** Menor plazo que admite un nivel. */
export function minRetentionDays(level: RetentionLevel): number {
  return level === "high" || level === "unclassified" ? AI_ACT_MIN_RETENTION_DAYS : MIN_RETENTION_DAYS;
}

/** Plazo de un nivel mientras la organización no lo haya fijado. */
export function defaultRetentionDays(level: RetentionLevel): number {
  return Math.max(DEFAULT_RETENTION_DAYS, minRetentionDays(level));
}

/** Un plazo válido para ese nivel: entero de 1 a 365 y, en los niveles con suelo, no menor que el del AI Act. */
export function validateLevelRetention(level: RetentionLevel, value: unknown, field = "days"): number {
  const days = validateRetentionDays(value, field);
  const min = minRetentionDays(level);
  if (days < min) {
    throw new ValidationError("Invalid retention", { [field]: `${level === "high" ? "High-risk" : "Unclassified"} agents must keep traces at least ${min} days (EU AI Act, art. 26.6)` });
  }
  return days;
}

export type RetentionDaysByLevel = Record<RetentionLevel, number>;

/** Plazo con el que se conservan las trazas de un agente: el de su nivel. */
export function retentionDaysFor(risk: RiskLevel | null, byLevel: RetentionDaysByLevel): number {
  return byLevel[retentionLevelOf(risk)];
}

export interface AgentRetention {
  experimentId: string;
  name: string;
  serviceName: string;
  /** null = sin clasificar */
  level: RiskLevel | null;
  effectiveDays: number;
  intendedPurpose: string;
  classifiedBy: { id: string; name: string | null; email: string } | null;
  classifiedAt: string | null;
}

export interface LevelRetention {
  level: RetentionLevel;
  days: number;
  minDays: number;
  agents: number;
}

export interface RetentionPolicy {
  organizationId: string;
  minDays: number;
  maxDays: number;
  aiActFloorDays: number;
  levels: LevelRetention[];
  agents: AgentRetention[];
}

/** Lo que pasaría al cambiar el plazo de un nivel. `spans` null = no se pudo contar. */
export interface LevelChangePreview {
  level: RetentionLevel;
  previousDays: number;
  days: number;
  /** el nuevo plazo es menor: la próxima purga borra lo que lo supere y no se recupera */
  lowering: boolean;
  /** agentes de ese nivel a los que les afecta */
  agents: number;
  spans: number | null;
}

/** Un experimento que el worker de purga debe revisar. */
export interface PurgeTarget {
  organizationId: string;
  experimentId: string;
  serviceName: string;
  days: number;
}
