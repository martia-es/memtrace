import type { Pool } from "pg";
import type { ModelQualityRepository } from "@/application/ports/model-quality-repository";
import type { MatchDecision, MatchDecisionKind } from "@/domain/model-quality";

// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decisiones sobre las coincidencias de calidad por modelo (ADR-025, ampliación), en `model_quality_matches`. */
export class PostgresModelQualityRepository implements ModelQualityRepository {
  constructor(private readonly pool: Pool) {}

  async listDecisions(organizationId: string): Promise<MatchDecision[]> {
    if (!UUID.test(organizationId)) return [];
    const { rows } = await this.pool.query<{ model_key: string; arena_model_name: string; decision: MatchDecisionKind }>(
      "SELECT model_key, arena_model_name, decision FROM model_quality_matches WHERE organization_id = $1 ORDER BY model_key, arena_model_name",
      [organizationId],
    );
    return rows.map((r) => ({ modelKey: r.model_key, arenaModelName: r.arena_model_name, decision: r.decision }));
  }

  async confirm(organizationId: string, modelKey: string, arenaModelName: string, userId: string): Promise<void> {
    await this.inTransaction(async (q) => {
      // una sola respuesta «positiva» por clave: confirmar sustituye a otra confirmación o a un «sin equivalente»
      await q("DELETE FROM model_quality_matches WHERE organization_id = $1 AND model_key = $2 AND decision IN ('confirmed', 'no_equivalent')", [organizationId, modelKey]);
      // si esa entrada estaba descartada, confirmarla manda sobre el descarte
      await q("DELETE FROM model_quality_matches WHERE organization_id = $1 AND model_key = $2 AND arena_model_name = $3", [organizationId, modelKey, arenaModelName]);
      await q("INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision, decided_by) VALUES ($1, $2, $3, 'confirmed', $4)", [organizationId, modelKey, arenaModelName, userId]);
    });
  }

  async reject(organizationId: string, modelKey: string, arenaModelNames: string[], userId: string): Promise<void> {
    if (arenaModelNames.length === 0) return;
    await this.pool.query(
      `INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision, decided_by)
       SELECT $1, $2, n, 'rejected', $4 FROM unnest($3::text[]) AS n
       ON CONFLICT (organization_id, model_key, arena_model_name) DO NOTHING`,
      [organizationId, modelKey, arenaModelNames, userId],
    );
  }

  async setNoEquivalent(organizationId: string, modelKey: string, userId: string): Promise<void> {
    await this.inTransaction(async (q) => {
      await q("DELETE FROM model_quality_matches WHERE organization_id = $1 AND model_key = $2 AND decision IN ('confirmed', 'no_equivalent')", [organizationId, modelKey]);
      await q("INSERT INTO model_quality_matches (organization_id, model_key, arena_model_name, decision, decided_by) VALUES ($1, $2, '', 'no_equivalent', $3)", [organizationId, modelKey, userId]);
    });
  }

  async clear(organizationId: string, modelKey: string): Promise<boolean> {
    if (!UUID.test(organizationId)) return false;
    const result = await this.pool.query("DELETE FROM model_quality_matches WHERE organization_id = $1 AND model_key = $2", [organizationId, modelKey]);
    return (result.rowCount ?? 0) > 0;
  }

  private async inTransaction(run: (query: (sql: string, params: unknown[]) => Promise<unknown>) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await run((sql, params) => client.query(sql, params as unknown[]));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
