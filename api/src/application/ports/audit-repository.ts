import type { AuditEntry, AuditEntryInput, AuditFilter } from "@/domain/audit";

/** Registro de auditoría en PostgreSQL (ADR-080). Solo se añade: no hay actualizar ni borrar entradas sueltas. */
export interface AuditRepository {
  /** Añade la entrada. Con `dedupeWithinSeconds`, no si el mismo actor ya hizo lo mismo sobre el mismo objetivo en ese margen. */
  append(entry: AuditEntryInput, dedupeWithinSeconds?: number): Promise<void>;
  /** Más recientes primero. `cursor` es el id de la última entrada de la página anterior. */
  list(organizationId: string, filter: AuditFilter, limit: number, cursor?: string): Promise<{ items: AuditEntry[]; nextCursor: string | null }>;
  /** Purga por antigüedad (no por entrada). Devuelve cuántas borró. */
  purgeOlderThan(cutoff: Date): Promise<number>;
}
