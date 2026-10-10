import type { PurgeTarget, RetentionPolicy } from "@/domain/retention";

/** Plazos de retención guardados en PostgreSQL (ADR-080). */
export interface RetentionRepository {
  /** La política de una organización con el plazo efectivo de cada experimento, o null si no existe. */
  getPolicy(organizationId: string): Promise<RetentionPolicy | null>;
  /**
   * Cambia el plazo de la organización. Los overrides que quedarían más largos que el nuevo plazo se quitan (valen lo mismo
   * que el default): devuelve sus experimentos. Null si la organización no existe.
   */
  setOrganizationDefault(organizationId: string, days: number): Promise<{ clearedExperimentIds: string[] } | null>;
  /** Pone (o quita, con null) el override de un experimento de esa organización. False si el experimento no es suyo. */
  setExperimentOverride(organizationId: string, experimentId: string, days: number | null): Promise<boolean>;
  /** Todos los experimentos con su plazo efectivo, para el worker de purga. */
  listPurgeTargets(): Promise<PurgeTarget[]>;
}
