import type { MatchDecision } from "@/domain/model-quality";

/**
 * Puerto hacia las decisiones sobre qué entrada de Arena es cada modelo (ADR-025, ampliación). Son de la organización: nunca se
 * lee ni se escribe una decisión de otra. Solo se guardan decisiones de personas; las coincidencias exactas se calculan al leer.
 */
export interface ModelQualityRepository {
  listDecisions(organizationId: string): Promise<MatchDecision[]>;
  /** Fija la entrada que es el modelo. Sustituye a una confirmación o a un «sin equivalente» anteriores de esa clave. */
  confirm(organizationId: string, modelKey: string, arenaModelName: string, userId: string): Promise<void>;
  /** Descarta estas entradas: no se vuelven a proponer. No toca las ya descartadas. */
  reject(organizationId: string, modelKey: string, arenaModelNames: string[], userId: string): Promise<void>;
  /** Arena no publica el modelo. Sustituye a una confirmación anterior. */
  setNoEquivalent(organizationId: string, modelKey: string, userId: string): Promise<void>;
  /** Borra todas las decisiones de la clave. `false` si no había ninguna. */
  clear(organizationId: string, modelKey: string): Promise<boolean>;
}
