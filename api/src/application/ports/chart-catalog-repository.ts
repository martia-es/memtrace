import type { CatalogEntry, CatalogKind, Visibility } from "@/domain/chart-catalog";

/** Ediciones del catálogo de datos de las Custom charts (ADR-077). PostgreSQL. */
export interface ChartCatalogRepository {
  /** Todas las ediciones del experimento. */
  list(experimentId: string): Promise<CatalogEntry[]>;
  /** Crea o sustituye la edición de esa clave. */
  upsert(experimentId: string, entry: { kind: CatalogKind; key: string; displayName: string | null; visibility: Visibility }, userId: string): Promise<CatalogEntry>;
  /** Quita la edición (vuelve a automático). Devuelve false si no existía. */
  delete(experimentId: string, kind: CatalogKind, key: string): Promise<boolean>;
}
