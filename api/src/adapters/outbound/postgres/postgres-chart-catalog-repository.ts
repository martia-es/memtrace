import type { Pool } from "pg";
import type { ChartCatalogRepository } from "@/application/ports/chart-catalog-repository";
import type { CatalogEntry, CatalogKind, Visibility } from "@/domain/chart-catalog";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no hay nada"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  kind: CatalogKind;
  key: string;
  display_name: string | null;
  visibility: Visibility;
  updated_by: string | null;
  updated_at: Ts;
}

const toEntry = (r: Row): CatalogEntry => ({ kind: r.kind, key: r.key, displayName: r.display_name, visibility: r.visibility, updatedBy: r.updated_by, updatedAt: iso(r.updated_at) });

export class PostgresChartCatalogRepository implements ChartCatalogRepository {
  constructor(private readonly pool: Pool) {}

  async list(experimentId: string): Promise<CatalogEntry[]> {
    if (!UUID.test(experimentId)) return [];
    const { rows } = await this.pool.query<Row>(
      "SELECT kind, key, display_name, visibility, updated_by, updated_at FROM chart_catalog_entries WHERE experiment_id = $1 ORDER BY kind, key",
      [experimentId],
    );
    return rows.map(toEntry);
  }

  async upsert(experimentId: string, entry: { kind: CatalogKind; key: string; displayName: string | null; visibility: Visibility }, userId: string): Promise<CatalogEntry> {
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO chart_catalog_entries (experiment_id, kind, key, display_name, visibility, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (experiment_id, kind, key)
       DO UPDATE SET display_name = EXCLUDED.display_name, visibility = EXCLUDED.visibility, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING kind, key, display_name, visibility, updated_by, updated_at`,
      [experimentId, entry.kind, entry.key, entry.displayName, entry.visibility, userId],
    );
    return toEntry(rows[0]!);
  }

  async delete(experimentId: string, kind: CatalogKind, key: string): Promise<boolean> {
    if (!UUID.test(experimentId)) return false;
    const result = await this.pool.query("DELETE FROM chart_catalog_entries WHERE experiment_id = $1 AND kind = $2 AND key = $3", [experimentId, kind, key]);
    return (result.rowCount ?? 0) > 0;
  }
}
