import type { ModelQualityItemDto, ModelQualityResponse } from "@contract";

/** Qué modelos enseña la tabla de precios. Va en la query de la URL (`?show=in_use`); «todos» es el valor por defecto y no se escribe. */
export type QualityScope = "all" | "in_use" | "review";

export const QUALITY_SCOPES: QualityScope[] = ["all", "in_use", "review"];

export function parseScope(value: unknown): QualityScope {
  return typeof value === "string" && (QUALITY_SCOPES as string[]).includes(value) ? (value as QualityScope) : "all";
}

/** Lo que dice la celda de calidad de un modelo, sin tocar el DOM. */
export type QualityCell =
  | { kind: "score"; elo: number; ci: number; rank: number; votes: number; arenaName: string; via: string | null; confirmed: boolean; stale: boolean }
  | { kind: "candidate"; arenaName: string; count: number }
  | { kind: "none" }
  | { kind: "no_equivalent" }
  | { kind: "unavailable" };

/** `item` es `undefined` cuando la API no lo trae (no tiene puntuación ni se usa): para el usuario es «sin equivalente en Arena». */
export function qualityCell(item: ModelQualityItemDto | undefined, available: boolean): QualityCell {
  if (!available) return { kind: "unavailable" };
  if (!item) return { kind: "none" };
  if (item.state === "matched" && item.quality) {
    const q = item.quality;
    return { kind: "score", elo: q.elo, ci: q.ci, rank: q.rank, votes: q.votes, arenaName: q.arenaName, via: item.via, confirmed: q.origin === "confirmed", stale: q.stale };
  }
  if (item.state === "candidate" && item.candidate) return { kind: "candidate", arenaName: item.candidate.arenaName, count: item.candidateCount };
  if (item.state === "no_equivalent") return { kind: "no_equivalent" };
  return { kind: "none" };
}

export const isScored = (item: ModelQualityItemDto | undefined): boolean => item?.state === "matched" && item.quality !== null;

/** Escala de la barra: del mínimo al máximo Elo visto, con un margen. Una barra al 0 % no se distinguiría de «sin dato». */
export function eloScale(items: readonly ModelQualityItemDto[]): { lo: number; hi: number } | null {
  const values = items.flatMap((i) => (i.quality ? [i.quality.elo] : []));
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return { lo: lo - Math.max(10, (hi - lo) * 0.15), hi };
}

export function eloBarWidth(elo: number, scale: { lo: number; hi: number } | null): string {
  if (!scale || scale.hi <= scale.lo) return "100%";
  return `${Math.round(Math.max(4, Math.min(100, ((elo - scale.lo) / (scale.hi - scale.lo)) * 100)))}%`;
}

/** Orden por calidad: de más a menos Elo, y los que no tienen puntuación siempre al final, sea cual sea el sentido. */
export function compareElo(a: ModelQualityItemDto | undefined, b: ModelQualityItemDto | undefined, direction: 1 | -1): number {
  const ea = a?.quality?.elo;
  const eb = b?.quality?.elo;
  if (ea === undefined && eb === undefined) return 0;
  if (ea === undefined) return 1;
  if (eb === undefined) return -1;
  return (ea - eb) * direction;
}

export function itemsByModelId(response: ModelQualityResponse | null): Map<string, ModelQualityItemDto> {
  return new Map((response?.items ?? []).map((i) => [i.modelId, i]));
}

/** ¿Pasa el modelo el filtro de la tabla? `items` es lo que trae la API; sin entrada, el modelo no se usa ni tiene candidato. */
export function inScope(scope: QualityScope, item: ModelQualityItemDto | undefined): boolean {
  if (scope === "in_use") return item?.inUse === true;
  if (scope === "review") return item?.state === "candidate";
  return true;
}

export function snapshotNote(publishedAt: string | null): string {
  if (!publishedAt) return "";
  return new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
