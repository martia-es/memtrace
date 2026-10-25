import type { AgentSecurityDto } from "@contract";

/** Postura de seguridad de un agente (ADR-103): lógica pura de la pantalla Security. */

export type AgentSecurity = AgentSecurityDto;
export type RedTeamRunDto = AgentSecurityDto["redteam"]["runs"][number];

export const SECURITY_PERIODS = [7, 30, 90] as const;
export const DEFAULT_PERIOD = 30;

/** Periodo de la URL (`?days=`): uno de los ofrecidos, o 30 días. */
export function parsePeriod(value: unknown): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (SECURITY_PERIODS as readonly number[]).includes(n) ? n : DEFAULT_PERIOD;
}

/** `secret_leak` → `Secret leak`. Detectores y categorías llegan como identificadores del SDK. */
export function humanize(slug: string): string {
  const text = slug.replace(/[._]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : slug;
}

export type AsrTone = "neutral" | "ok" | "warn" | "error";

/** Ningún ataque tuvo éxito = verde; hasta un 10 % = aviso; más = error. Sin items evaluados no hay veredicto. */
export function asrTone(asr: number | null): AsrTone {
  if (asr === null) return "neutral";
  if (asr === 0) return "ok";
  return asr < 0.1 ? "warn" : "error";
}

/** El run de red team más reciente con algún item evaluado (la API los da del más nuevo al más antiguo). */
export function latestEvaluatedRun(posture: AgentSecurity): RedTeamRunDto | null {
  return posture.redteam.runs.find((r) => r.items > 0) ?? null;
}

/** Sin eventos ni runs: la pantalla explica cómo empezar en lugar de enseñar ceros. */
export function isUntouched(posture: AgentSecurity): boolean {
  return posture.events.total === 0 && posture.redteam.runs.length === 0;
}

/** La categoría donde más ataques tuvieron éxito, si alguno lo tuvo. */
export function worstCategory(run: RedTeamRunDto): RedTeamRunDto["byCategory"][number] | null {
  const worst = run.byCategory[0];
  return worst && worst.attacksSucceeded > 0 ? worst : null;
}
