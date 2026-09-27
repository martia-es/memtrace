/** Modelo de identidad y RBAC de 2 niveles (ADR-013): Organización -> Experimento. */

export type OrgRole = "org_admin";
export type ExperimentRole = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface Organization {
  id: string;
  name: string;
}

export interface Experiment {
  id: string;
  organizationId: string;
  name: string;
  /** ResourceAttributes["service.name"] emitido por el agente (piezas 1-3) */
  serviceName: string;
}

/**
 * Acceso resuelto de un usuario a un experimento concreto: org_admin de su
 * organización, o membership directa en el experimento. `null` si no tiene acceso.
 */
export type ExperimentAccess = "org_admin" | ExperimentRole | null;

/**
 * API key de agente (ADR-013, pieza 9): autentica la escritura de trazas de un experimento
 * concreto en el gateway de ingesta. Nunca se guarda en claro, solo su hash y un prefijo
 * identificador (para reconocerla en la UI sin poder reconstruirla).
 */
export interface ApiKey {
  id: string;
  experimentId: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Invitación a alguien que todavía no tiene cuenta (ADR-014). Se guarda por email porque
 * Auth.js no crea el usuario hasta que hace login por primera vez; se aplica y se borra
 * entonces (ver events.createUser en auth.ts).
 */
export type PendingInvitationTarget =
  | { organizationId: string; role: "org_admin" }
  | { experimentId: string; role: ExperimentRole };

export interface PendingInvitation {
  id: string;
  email: string;
  invitedByUserId: string;
  target: PendingInvitationTarget;
}
