/**
 * Registro de auditoría (ADR-093). Solo acciones de seguridad: conceder y quitar acceso, claves de agente, y el acceso de
 * una consultora a los datos de un cliente. Es append-only y sobrevive al borrado de lo que describe.
 */
export const AUDIT_ACTIONS = [
  "partnership.created",
  "partnership.revoked",
  "partner_grant.created",
  "partner_grant.revoked",
  "partner.access",
  "api_key.created",
  "api_key.revoked",
  "member.added",
  "member.invited",
  "org_admin.added",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface NewAuditEvent {
  action: AuditAction;
  actorUserId: string | null;
  actorEmail: string | null;
  organizationId: string | null;
  experimentId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** datos que explican la acción (rol, alcance…); nunca secretos ni valores de claves */
  detail?: Record<string, unknown>;
}

export interface AuditEvent extends Required<Omit<NewAuditEvent, "detail">> {
  id: string;
  at: string;
  detail: Record<string, unknown>;
}
