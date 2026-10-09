import type { ChartCatalogRepository } from "@/application/ports/chart-catalog-repository";
import { MAX_ENTRIES, isEmptyEdit, nameClash, validateDisplayName, validateKey, validateKind, validateVisibility, type CatalogEntry } from "@/domain/chart-catalog";
import { ValidationError } from "@/domain/errors";

/**
 * Catálogo de datos de las Custom charts (ADR-077). Guarda cómo quiere cada experimento llamar y mostrar sus pasos y atributos.
 * La autorización (leer con `experiment:read`, editar con `catalog:manage`) la decide la ruta; aquí solo las reglas del dominio.
 */
export class ChartCatalogService {
  constructor(private readonly repo: ChartCatalogRepository) {}

  list(experimentId: string): Promise<CatalogEntry[]> {
    return this.repo.list(experimentId);
  }

  /**
   * Crea, cambia o —si ya no dice nada— borra la edición de un paso o atributo. Devuelve la edición guardada, o null si volvió a
   * automático. Dos entradas del mismo tipo no pueden llamarse igual.
   */
  async save(experimentId: string, userId: string, input: { kind: unknown; key: unknown; displayName?: unknown; visibility?: unknown }): Promise<CatalogEntry | null> {
    const kind = validateKind(input.kind);
    const key = validateKey(input.key);
    const displayName = validateDisplayName(input.displayName);
    const visibility = validateVisibility(input.visibility);

    if (isEmptyEdit(displayName, visibility)) {
      await this.repo.delete(experimentId, kind, key);
      return null;
    }

    const existing = await this.repo.list(experimentId);
    if (displayName !== null) {
      const clash = nameClash(existing, kind, key, displayName);
      if (clash) throw new ValidationError("That name is already used", { displayName: `"${clash.displayName}" already names another ${kind}` });
    }
    const isNew = !existing.some((e) => e.kind === kind && e.key === key);
    if (isNew && existing.length >= MAX_ENTRIES) throw new ValidationError("Too many edits", { key: `At most ${MAX_ENTRIES} renamed or hidden items per experiment` });

    return this.repo.upsert(experimentId, { kind, key, displayName, visibility }, userId);
  }

  /** Vuelve a automático: el nombre del diccionario o el humanizado. No falla si no había edición. */
  async remove(experimentId: string, kind: unknown, key: unknown): Promise<boolean> {
    return this.repo.delete(experimentId, validateKind(kind), validateKey(key));
  }
}
