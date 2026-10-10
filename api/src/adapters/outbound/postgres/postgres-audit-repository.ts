import type { Pool } from "pg";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { AuditAction, AuditEntry, AuditEntryInput, AuditFilter } from "@/domain/audit";

type Ts = Date | string;
const iso = (v: Ts): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  at: Ts;
  organization_id: string;
  experiment_id: string | null;
  actor_user_id: string | null;
  actor_label: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
}

const toEntry = (r: Row): AuditEntry => ({
  id: String(r.id),
  at: iso(r.at),
  organizationId: r.organization_id,
  experimentId: r.experiment_id,
  actorUserId: r.actor_user_id,
  actorLabel: r.actor_label,
  action: r.action as AuditAction,
  targetType: r.target_type,
  targetId: r.target_id,
  metadata: r.metadata ?? {},
});

/** Registro de auditoría (ADR-080) en `audit_log`. A propósito no hay UPDATE ni DELETE de entradas sueltas. */
export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async append(entry: AuditEntryInput, dedupeWithinSeconds?: number): Promise<void> {
    const values = [entry.organizationId, entry.experimentId, entry.actorUserId, entry.actorLabel, entry.action, entry.targetType, entry.targetId, JSON.stringify(entry.metadata)];
    if (!dedupeWithinSeconds) {
      await this.pool.query(
        `INSERT INTO audit_log (organization_id, experiment_id, actor_user_id, actor_label, action, target_type, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        values,
      );
      return;
    }
    // misma persona, misma acción y mismo objetivo en el margen: ya está registrado
    await this.pool.query(
      `INSERT INTO audit_log (organization_id, experiment_id, actor_user_id, actor_label, action, target_type, target_id, metadata)
       SELECT $1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_log
           WHERE organization_id = $1 AND actor_label = $4 AND action = $5
             AND target_type IS NOT DISTINCT FROM $6 AND target_id IS NOT DISTINCT FROM $7
             AND at > now() - make_interval(secs => $9))`,
      [...values, dedupeWithinSeconds],
    );
  }

  async list(organizationId: string, filter: AuditFilter, limit: number, cursor?: string): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
    if (!UUID.test(organizationId)) return { items: [], nextCursor: null };
    const where = ["organization_id = $1"];
    const params: unknown[] = [organizationId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filter.from) add("at >= ?", filter.from);
    if (filter.to) add("at < ?", filter.to);
    if (filter.action) add("action = ?", filter.action);
    if (filter.experimentId && UUID.test(filter.experimentId)) add("experiment_id = ?", filter.experimentId);
    if (filter.actorUserId && UUID.test(filter.actorUserId)) add("actor_user_id = ?", filter.actorUserId);
    if (cursor && /^\d+$/.test(cursor)) add("id < ?", cursor);
    params.push(limit + 1);
    const { rows } = await this.pool.query<Row>(
      `SELECT id, at, organization_id, experiment_id, actor_user_id, actor_label, action, target_type, target_id, metadata
         FROM audit_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit).map(toEntry);
    return { items: page, nextCursor: rows.length > limit ? page[page.length - 1]!.id : null };
  }

  async purgeOlderThan(cutoff: Date): Promise<number> {
    const result = await this.pool.query("DELETE FROM audit_log WHERE at < $1", [cutoff]);
    return result.rowCount ?? 0;
  }
}
