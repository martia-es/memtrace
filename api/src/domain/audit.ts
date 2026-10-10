import { ValidationError } from "./errors";

/**
 * Registro de auditoría (ADR-084). Solo contenido ABIERTO, exportaciones y cambios de acceso o configuración: las listas y
 * las métricas no llevan contenido y taparían lo importante.
 */
export const AUDIT_ACTIONS = [
  "trace.view",
  "conversation.view",
  "data.export",
  "retention.update",
  "retention.purge",
  "member.add",
  "apikey.create",
  "apikey.revoke",
  "alert.create",
  "alert.update",
  "alert.delete",
  "budget.update",
  "budget.delete",
  /** un `org_admin` eximió a un agente de la regla de aprobación de la organización en un paso, o lo revirtió (ADR-076) */
  "approval_exemption.grant",
  "approval_exemption.revoke",
  "partnership.create",
  "partnership.revoke",
  "partner_grant.create",
  "partner_grant.revoke",
  /** una persona de una consultora entró en los datos de un cliente por su relación partner (ADR-091) */
  "partner.access",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/** Abrir la misma traza o conversación varias veces seguidas (el dashboard pide varias cosas a la vez) cuenta como una. */
export const VIEW_DEDUPE_SECONDS = 300;

/** Cuánto tiempo se conserva una entrada. El worker de purga borra lo más antiguo. */
export const AUDIT_RETENTION_DAYS = 365;

/** Un `metadata` es un resumen (cuántos, qué rango), nunca contenido: se acota para que no se cuele un texto largo. */
export const MAX_METADATA_CHARS = 2000;

export interface AuditEntryInput {
  organizationId: string;
  experimentId: string | null;
  /** NULL = el sistema (p. ej. la purga de retención) */
  actorUserId: string | null;
  /** email del actor en el momento: la entrada sobrevive a que se borre el usuario */
  actorLabel: string;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditEntry extends AuditEntryInput {
  id: string;
  at: string;
}

export interface AuditFilter {
  from?: Date;
  to?: Date;
  action?: AuditAction;
  experimentId?: string;
  actorUserId?: string;
}

export function validateMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(metadata).length > MAX_METADATA_CHARS) {
    throw new ValidationError("Audit metadata too large", { metadata: `At most ${MAX_METADATA_CHARS} characters: record identifiers and counts, never content` });
  }
  return metadata;
}
