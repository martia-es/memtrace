import type { AuditEvent, NewAuditEvent } from "@/domain/audit";
import type { AuditRepository } from "./ports/audit-repository";

export const ACCESS_AUDIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;

/**
 * Registro de acciones de seguridad (ADR-093). `record` falla en voz alta: una acción de seguridad sin rastro no debe pasar
 * desapercibida. `recordPartnerAccess` es distinto: va en el camino de lectura de datos, así que se limita a un evento por
 * persona y experimento cada 10 minutos y, si el registro falla, no tumba la petición (se deja constancia en el log).
 */
export class AuditService {
  private readonly recentAccess = new Map<string, number>();

  constructor(
    private readonly repository: AuditRepository,
    private readonly now: () => number = Date.now,
  ) {}

  record(event: NewAuditEvent): Promise<void> {
    return this.repository.append(event);
  }

  async recordPartnerAccess(actor: { userId: string; email: string | null }, experiment: { id: string; organizationId: string }): Promise<void> {
    const key = `${actor.userId}:${experiment.id}`;
    const at = this.now();
    const last = this.recentAccess.get(key);
    if (last !== undefined && at - last < ACCESS_AUDIT_WINDOW_MS) return;
    if (this.recentAccess.size >= MAX_TRACKED) this.prune(at);
    this.recentAccess.set(key, at);
    try {
      await this.repository.append({
        action: "partner.access",
        actorUserId: actor.userId,
        actorEmail: actor.email,
        organizationId: experiment.organizationId,
        experimentId: experiment.id,
        targetType: "experiment",
        targetId: experiment.id,
      });
    } catch (error) {
      this.recentAccess.delete(key); // que el siguiente acceso lo vuelva a intentar
      console.error("[memtrace-api] could not record partner access:", error);
    }
  }

  listForOrganization(organizationId: string, options: { limit?: number; before?: string; action?: string } = {}): Promise<AuditEvent[]> {
    return this.repository.listForOrganization(organizationId, { limit: Math.min(Math.max(options.limit ?? 100, 1), 500), before: options.before, action: options.action });
  }

  private prune(at: number) {
    for (const [key, when] of this.recentAccess) if (at - when >= ACCESS_AUDIT_WINDOW_MS) this.recentAccess.delete(key);
    if (this.recentAccess.size >= MAX_TRACKED) this.recentAccess.clear();
  }
}
