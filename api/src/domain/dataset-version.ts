import { ValidationError } from "@/domain/errors";

/** Parsea una versión de dataset escrita como "major.minor" (p. ej. "2.1"), el mismo formato que muestra el dashboard (ADR-032). */
export function parseDatasetVersionSpec(spec: string, field = "version"): { major: number; minor: number } {
  const match = /^(\d+)\.(\d+)$/.exec(spec.trim());
  if (!match) throw new ValidationError(`${field} must look like "major.minor", e.g. "2.1"`, { [field]: 'expected "major.minor"' });
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export interface DatasetChangeCounts {
  added: number;
  edited: number;
  removed: number;
}

/** Un commit estructural (alta/baja de items) sube MAJOR; si solo se editan contenidos, MINOR (ADR-032, ADR-041). */
export function bumpForChanges({ added, removed }: DatasetChangeCounts): "major" | "minor" {
  return added > 0 || removed > 0 ? "major" : "minor";
}

/** Nota automática de la versión: "Added 3 · Edited 2 · Removed 1" (solo lo que cambió, ADR-041). */
export function describeChanges({ added, edited, removed }: DatasetChangeCounts): string {
  const parts: string[] = [];
  if (added) parts.push(`Added ${added}`);
  if (edited) parts.push(`Edited ${edited}`);
  if (removed) parts.push(`Removed ${removed}`);
  return parts.join(" · ");
}
