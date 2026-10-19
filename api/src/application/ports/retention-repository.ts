import type { PurgeTarget, RetentionLevel, RetentionPolicy } from "@/domain/retention";

/** Plazos de retención por nivel de riesgo guardados en PostgreSQL (ADR-084, ADR-102). */
export interface RetentionRepository {
  /** La política de una organización: el plazo de cada nivel y el de cada agente (el de su nivel), o null si no existe. */
  getPolicy(organizationId: string): Promise<RetentionPolicy | null>;
  /** Fija el plazo de un nivel. False si la organización no existe. El suelo del AI Act lo valida el dominio. */
  setLevelDays(organizationId: string, level: RetentionLevel, days: number): Promise<boolean>;
  /**
   * Plazo efectivo con el que se conservan las trazas de un `service.name` (el más largo si varias organizaciones lo comparten),
   * o el máximo de todos si no se indica servicio. Null si ningún experimento lo usa.
   */
  effectiveDaysForService(serviceName?: string): Promise<number | null>;
  /** Todos los experimentos con su plazo efectivo, para el worker de purga. */
  listPurgeTargets(): Promise<PurgeTarget[]>;
}
