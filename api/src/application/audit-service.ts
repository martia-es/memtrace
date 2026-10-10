import type { AuditRepository } from "@/application/ports/audit-repository";
import { VIEW_DEDUPE_SECONDS, validateMetadata, type AuditEntry, type AuditEntryInput, type AuditFilter } from "@/domain/audit";

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

/** Quién hizo qué (ADR-084). La autorización de lectura (`audit:read`) la decide la ruta. */
export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  /** Registra o falla: para lo que no debe ocurrir sin dejar rastro (exportar datos). */
  async record(entry: AuditEntryInput): Promise<void> {
    await this.repo.append({ ...entry, metadata: validateMetadata(entry.metadata) });
  }

  /**
   * Una apertura de contenido (traza, conversación): una sola entrada por persona y objetivo en cinco minutos, y sin romper la
   * petición si falla el registro (se deja en el log del servidor).
   */
  async recordView(entry: AuditEntryInput): Promise<void> {
    try {
      await this.repo.append({ ...entry, metadata: validateMetadata(entry.metadata) }, VIEW_DEDUPE_SECONDS);
    } catch (error) {
      console.error(`[audit] could not record ${entry.action}:`, error);
    }
  }

  /**
   * Registra sin romper la petición: una lectura de contenido no se bloquea porque falle el registro, pero el fallo
   * queda en el log del servidor y no se traga en silencio.
   */
  async recordBestEffort(entry: AuditEntryInput): Promise<void> {
    try {
      await this.record(entry);
    } catch (error) {
      console.error(`[audit] could not record ${entry.action}:`, error);
    }
  }

  list(organizationId: string, filter: AuditFilter, options: { limit?: number; cursor?: string } = {}): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
    return this.repo.list(organizationId, filter, limit, options.cursor);
  }

  purgeOlderThan(cutoff: Date): Promise<number> {
    return this.repo.purgeOlderThan(cutoff);
  }
}
