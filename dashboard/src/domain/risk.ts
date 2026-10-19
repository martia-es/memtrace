/** Reglas de presentación de la clasificación de riesgo y de su retención (ADR-102). Sin Vue ni HTTP. */
import type { RetentionLevelDto, RetentionPolicyDto } from "@contract";
import { lazyMessages } from "./translate";

export type RiskLevel = "minimal" | "limited" | "high";
export const RISK_LEVELS: RiskLevel[] = ["high", "limited", "minimal"];

export const RISK_LABEL: Record<RetentionLevelDto, string> = lazyMessages({ high: "riskLevel.label_high", limited: "riskLevel.label_limited", minimal: "riskLevel.label_minimal", unclassified: "riskLevel.label_unclassified" });
export const RISK_DESCRIPTION: Record<RetentionLevelDto, string> = lazyMessages({
  high: "riskLevel.description_high",
  limited: "riskLevel.description_limited",
  minimal: "riskLevel.description_minimal",
  unclassified: "riskLevel.description_unclassified",
});

type Tone = "ok" | "error" | "warn" | "neutral" | "info" | "highlight" | "accent";
/** Sin clasificar es un aviso, nunca «bajo riesgo»: nadie ha revisado el agente. */
export const RISK_TONE: Record<RetentionLevelDto, Tone> = { high: "error", limited: "accent", minimal: "accent", unclassified: "warn" };

/** Nivel con el que se pintan la política y el catálogo: un agente sin clasificar es `unclassified`. */
export function levelOf(risk: { level: RiskLevel | null } | null | undefined): RetentionLevelDto {
  return risk?.level ?? "unclassified";
}

/** Plazo de retención de un nivel en la política. */
export function daysOfLevel(policy: Pick<RetentionPolicyDto, "levels">, level: RetentionLevelDto): number {
  return policy.levels.find((l) => l.level === level)?.days ?? 0;
}

const RANK: Record<RiskLevel, number> = { minimal: 0, limited: 1, high: 2 };
/** Cambiar a un nivel inferior solo lo hace un administrador de la organización (ADR-102). */
export function isLowering(from: RiskLevel | null, to: RiskLevel): boolean {
  return from !== null && RANK[to] < RANK[from];
}

/** Lo que dice el campo del plazo cuando no es válido, o null si lo es. */
export function retentionFieldError(days: number | null, min: number, max: number): "range" | null {
  return days !== null && Number.isInteger(days) && days >= min && days <= max ? null : "range";
}
