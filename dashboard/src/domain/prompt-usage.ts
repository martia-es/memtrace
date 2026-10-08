import type { PromptTagDto, PromptUsageDto } from "@contract";

/** Lo que informan los agentes sobre la versión de un prompt que usan (ADR-068), listo para pintar. */
export type UsageState =
  /** sigue un tag y ya usa la versión a la que apunta ahora */
  | "in_sync"
  /** sigue un tag que apunta a otra versión: aún no se ha enterado (o una réplica no se ha actualizado) */
  | "behind"
  /** pidió una versión fija: no sigue ningún tag */
  | "pinned"
  /** hace rato que no informa: ya no es la versión que corre */
  | "stale";

export interface UsageRow extends PromptUsageDto {
  state: UsageState;
  /** versión a la que apunta ahora el tag que sigue; null si va fijo o el tag ya no existe */
  tagVersion: number | null;
}

const STATE_ORDER: Record<UsageState, number> = { behind: 0, in_sync: 1, pinned: 2, stale: 3 };

export function describeUsage(usage: PromptUsageDto[], tags: PromptTagDto[]): UsageRow[] {
  const current = new Map(tags.map((t) => [t.tag, t.version]));
  return usage
    .map((u): UsageRow => {
      const tagVersion = u.tag === "" ? null : (current.get(u.tag) ?? null);
      const state: UsageState = !u.active ? "stale" : u.tag === "" ? "pinned" : tagVersion !== null && tagVersion !== u.version ? "behind" : "in_sync";
      return { ...u, state, tagVersion };
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.environment.localeCompare(b.environment) || b.version - a.version);
}

/** Entornos donde la versión corre ahora (informado hace poco), para marcarla en la lista de versiones. */
export function environmentsRunning(usage: PromptUsageDto[], version: number): string[] {
  const names = usage.filter((u) => u.active && u.version === version).map((u) => u.environment || "?");
  return [...new Set(names)].sort();
}
