import type { AuditEvent, NewAuditEvent } from "@/domain/audit";

export interface AuditRepository {
  append(event: NewAuditEvent): Promise<void>;
  /** los más recientes primero; `before` (ISO) pagina hacia atrás */
  listForOrganization(organizationId: string, options: { limit: number; before?: string; action?: string }): Promise<AuditEvent[]>;
}
