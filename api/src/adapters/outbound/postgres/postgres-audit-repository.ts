import type { Pool } from "pg";
import type { AuditRepository } from "@/application/ports/audit-repository";
import type { AuditEvent, NewAuditEvent } from "@/domain/audit";

interface Row {
  id: string;
  at: Date | string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  organization_id: string | null;
  experiment_id: string | null;
  target_type: string | null;
  target_id: string | null;
  detail: Record<string, unknown>;
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async append(event: NewAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (actor_user_id, actor_email, action, organization_id, experiment_id, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [event.actorUserId, event.actorEmail, event.action, event.organizationId, event.experimentId ?? null, event.targetType ?? null, event.targetId ?? null, JSON.stringify(event.detail ?? {})],
    );
  }

  async listForOrganization(organizationId: string, options: { limit: number; before?: string; action?: string }): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT id, at, actor_user_id, actor_email, action, organization_id, experiment_id, target_type, target_id, detail
         FROM audit_events
        WHERE organization_id = $1
          AND ($2::timestamptz IS NULL OR at < $2)
          AND ($3::text IS NULL OR action = $3)
        ORDER BY at DESC, id DESC
        LIMIT $4`,
      [organizationId, options.before ?? null, options.action ?? null, options.limit],
    );
    return rows.map((r) => ({
      id: r.id,
      at: r.at instanceof Date ? r.at.toISOString() : r.at,
      actorUserId: r.actor_user_id,
      actorEmail: r.actor_email,
      action: r.action as AuditEvent["action"],
      organizationId: r.organization_id,
      experimentId: r.experiment_id,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: r.detail,
    }));
  }
}
