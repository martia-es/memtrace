import type { Pool } from "pg";
import type { RetentionRepository } from "@/application/ports/retention-repository";
import {
  AI_ACT_MIN_RETENTION_DAYS,
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_LEVELS,
  defaultRetentionDays,
  minRetentionDays,
  retentionLevelOf,
  type PurgeTarget,
  type RetentionLevel,
  type RetentionPolicy,
} from "@/domain/retention";
import type { RiskLevel } from "@/domain/risk";

// un id con otra forma haría fallar el cast a uuid de Postgres (500): desde la API es simplemente "no existe"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Plazo de un experimento: el de su nivel de riesgo en su organización. Si la organización aún no ha fijado ese nivel (una
 * organización nueva) vale el de por defecto, que ya respeta el suelo del AI Act ($1 = suelo, $2 = defecto de los demás).
 */
const DAYS_SQL = `COALESCE(rp.retention_days, CASE WHEN COALESCE(e.risk_level, 'unclassified') IN ('high', 'unclassified') THEN $1::int ELSE $2::int END)`;
const JOIN_SQL = `experiments e JOIN organizations o ON o.id = e.organization_id
                  LEFT JOIN risk_policies rp ON rp.organization_id = e.organization_id AND rp.risk_level = COALESCE(e.risk_level, 'unclassified')`;
const DEFAULTS = [Math.max(DEFAULT_RETENTION_DAYS, AI_ACT_MIN_RETENTION_DAYS), DEFAULT_RETENTION_DAYS];

/** Plazos de retención de trazas por nivel de riesgo (ADR-102), sobre la tabla `risk_policies`. */
export class PostgresRetentionRepository implements RetentionRepository {
  constructor(private readonly pool: Pool) {}

  async getPolicy(organizationId: string): Promise<RetentionPolicy | null> {
    if (!UUID.test(organizationId)) return null;
    const org = await this.pool.query("SELECT 1 FROM organizations WHERE id = $1", [organizationId]);
    if (org.rows.length === 0) return null;
    const stored = await this.pool.query<{ risk_level: RetentionLevel; retention_days: number }>("SELECT risk_level, retention_days FROM risk_policies WHERE organization_id = $1", [organizationId]);
    const days = Object.fromEntries(RETENTION_LEVELS.map((l) => [l, defaultRetentionDays(l)])) as Record<RetentionLevel, number>;
    for (const r of stored.rows) days[r.risk_level] = r.retention_days;

    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      service_name: string;
      risk_level: RiskLevel | null;
      intended_purpose: string;
      risk_classified_by: string | null;
      risk_classified_at: Date | string | null;
      by_name: string | null;
      by_email: string | null;
    }>(
      `SELECT e.id, e.name, e.service_name, e.risk_level, e.intended_purpose, e.risk_classified_by, e.risk_classified_at, u.name AS by_name, u.email AS by_email
         FROM experiments e LEFT JOIN users u ON u.id = e.risk_classified_by
        WHERE e.organization_id = $1 ORDER BY e.name, e.id`,
      [organizationId],
    );
    const agents = rows.map((r) => ({
      experimentId: r.id,
      name: r.name,
      serviceName: r.service_name,
      level: r.risk_level,
      effectiveDays: days[retentionLevelOf(r.risk_level)],
      intendedPurpose: r.intended_purpose,
      classifiedBy: r.risk_classified_by ? { id: r.risk_classified_by, name: r.by_name, email: r.by_email ?? "" } : null,
      classifiedAt: r.risk_classified_at ? new Date(r.risk_classified_at).toISOString() : null,
    }));
    return {
      organizationId,
      minDays: MIN_RETENTION_DAYS,
      maxDays: MAX_RETENTION_DAYS,
      aiActFloorDays: AI_ACT_MIN_RETENTION_DAYS,
      levels: RETENTION_LEVELS.map((level) => ({ level, days: days[level], minDays: minRetentionDays(level), agents: agents.filter((a) => retentionLevelOf(a.level) === level).length })),
      agents,
    };
  }

  async setLevelDays(organizationId: string, level: RetentionLevel, days: number): Promise<boolean> {
    if (!UUID.test(organizationId)) return false;
    const { rowCount } = await this.pool.query(
      `INSERT INTO risk_policies (organization_id, risk_level, retention_days)
       SELECT id, $2, $3 FROM organizations WHERE id = $1
       ON CONFLICT (organization_id, risk_level) DO UPDATE SET retention_days = EXCLUDED.retention_days, updated_at = now()`,
      [organizationId, level, days],
    );
    return (rowCount ?? 0) > 0;
  }

  async effectiveDaysForService(serviceName?: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ days: number | null }>(
      `SELECT MAX(${DAYS_SQL}) AS days FROM ${JOIN_SQL} WHERE $3::text IS NULL OR e.service_name = $3`,
      [...DEFAULTS, serviceName ?? null],
    );
    return rows[0]?.days ?? null;
  }

  async listPurgeTargets(): Promise<PurgeTarget[]> {
    // Dos organizaciones pueden usar el mismo `service.name` y las trazas no se pueden separar por organización: se aplica
    // el plazo MÁS LARGO, porque un borrado equivocado no se deshace y uno que se queda corto sí se corrige (ADR-084).
    const { rows } = await this.pool.query<{ organization_id: string; id: string; service_name: string; days: number }>(
      `SELECT DISTINCT ON (e.service_name) e.organization_id, e.id, e.service_name, ${DAYS_SQL} AS days
         FROM ${JOIN_SQL}
        ORDER BY e.service_name, days DESC, e.id`,
      DEFAULTS,
    );
    return rows.map((r) => ({ organizationId: r.organization_id, experimentId: r.id, serviceName: r.service_name, days: r.days }));
  }
}
