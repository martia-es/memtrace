import { ValidationError } from "./errors";

/**
 * Clasificación de riesgo de un agente (ADR-102). Es una declaración de una persona sobre el agente, no algo que MemTrace
 * infiera de las trazas: el nivel depende del caso de uso, no del comportamiento. Reglas puras, sin tecnología.
 */
export const RISK_LEVELS = ["minimal", "limited", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** De menor a mayor riesgo; sirve para saber si un cambio baja el nivel. */
const RANK: Record<RiskLevel, number> = { minimal: 0, limited: 1, high: 2 };

export const MAX_RISK_TEXT = 2000;

export interface RiskClassification {
  /** null = sin clasificar. No equivale a `minimal`: nadie ha revisado el agente */
  level: RiskLevel | null;
  intendedPurpose: string;
  knownLimitations: string;
  classifiedBy: { id: string; name: string | null; email: string } | null;
  classifiedAt: string | null;
}

export interface RiskInput {
  level: RiskLevel;
  intendedPurpose: string;
  knownLimitations: string;
}

export function validateRiskInput(input: RiskInput): void {
  const errors: Record<string, string> = {};
  if (!(RISK_LEVELS as readonly string[]).includes(input.level)) errors.level = `Must be one of: ${RISK_LEVELS.join(", ")}`;
  for (const field of ["intendedPurpose", "knownLimitations"] as const) {
    if (input[field].length > MAX_RISK_TEXT) errors[field] = `At most ${MAX_RISK_TEXT} characters`;
  }
  // un agente de alto riesgo sin finalidad declarada no tiene qué evaluarse (art. 13 del AI Act)
  if (input.level === "high" && input.intendedPurpose.trim() === "") errors.intendedPurpose = "Required for a high-risk agent";
  if (Object.keys(errors).length > 0) throw new ValidationError("Invalid risk classification", errors);
}

/** Cambiar a un nivel inferior solo lo hace quien administra la organización: si no, quien está sujeto a los requisitos se los quitaría. */
export function isLowering(from: RiskLevel | null, to: RiskLevel): boolean {
  return from !== null && RANK[to] < RANK[from];
}
