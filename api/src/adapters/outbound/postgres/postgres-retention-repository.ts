import type { Pool } from "pg";
import type { RetentionRepository } from "@/application/ports/retention-repository";
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, effectiveRetentionDays, type PurgeTarget, type RetentionPolicy } from "@/domain/retention";

// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plazos de retención de trazas (ADR-084) sobre las columnas `trace_retention_days` de organizaciones y experimentos. */
export class PostgresRetentionRepository implements RetentionRepository {
  constructor(private readonly pool: Pool) {}

  async getPolicy(organizationId: string): Promise<RetentionPolicy | null> {
    if (!UUID.test(organizationId)) return null;
    const org = await this.pool.query<{ trace_retention_days: number }>("SELECT trace_retention_days FROM organizations WHERE id = $1", [organizationId]);
    if (org.rows.length === 0) return null;
    const defaultDays = org.rows[0]!.trace_retention_days;
    const { rows } = await this.pool.query<{ id: string; name: string; service_name: string; trace_retention_days: number | null }>(
      "SELECT id, name, service_name, trace_retention_days FROM experiments WHERE organization_id = $1 ORDER BY name, id",
      [organizationId],
    );
    return {
      organizationId,
      defaultDays,
      minDays: MIN_RETENTION_DAYS,
      maxDays: MAX_RETENTION_DAYS,
      experiments: rows.map((r) => ({
        experimentId: r.id,
        name: r.name,
        serviceName: r.service_name,
        overrideDays: r.trace_retention_days,
        effectiveDays: effectiveRetentionDays(defaultDays, r.trace_retention_days),
      })),
    };
  }

  async setOrganizationDefault(organizationId: string, days: number): Promise<{ clearedExperimentIds: string[] } | null> {
    if (!UUID.test(organizationId)) return null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query("UPDATE organizations SET trace_retention_days = $2 WHERE id = $1", [organizationId, days]);
      if ((updated.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      // un override más largo que el nuevo plazo ya no significa nada: vale lo mismo que el de la organización
      const cleared = await client.query<{ id: string }>(
        "UPDATE experiments SET trace_retention_days = NULL WHERE organization_id = $1 AND trace_retention_days > $2 RETURNING id",
        [organizationId, days],
      );
      await client.query("COMMIT");
      return { clearedExperimentIds: cleared.rows.map((r) => r.id) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async setExperimentOverride(organizationId: string, experimentId: string, days: number | null): Promise<boolean> {
    if (!UUID.test(organizationId) || !UUID.test(experimentId)) return false;
    const result = await this.pool.query("UPDATE experiments SET trace_retention_days = $3 WHERE id = $2 AND organization_id = $1", [organizationId, experimentId, days]);
    return (result.rowCount ?? 0) > 0;
  }

  async listPurgeTargets(): Promise<PurgeTarget[]> {
    // Dos organizaciones pueden usar el mismo `service.name` y las trazas no se pueden separar por organización: se aplica
    // el plazo MÁS LARGO, porque un borrado equivocado no se deshace y uno que se queda corto sí se corrige (ADR-084).
    const { rows } = await this.pool.query<{ organization_id: string; id: string; service_name: string; days: number }>(
      `SELECT DISTINCT ON (e.service_name) e.organization_id, e.id, e.service_name,
              LEAST(o.trace_retention_days, COALESCE(e.trace_retention_days, o.trace_retention_days)) AS days
         FROM experiments e JOIN organizations o ON o.id = e.organization_id
        ORDER BY e.service_name, days DESC, e.id`,
    );
    return rows.map((r) => ({ organizationId: r.organization_id, experimentId: r.id, serviceName: r.service_name, days: r.days }));
  }
}
