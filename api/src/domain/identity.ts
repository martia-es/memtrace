/** Modelo de identidad y RBAC de 2 niveles (ADR-013): Organización -> Experimento. */

export type OrgRole = "org_admin";
export type ExperimentRole = "admin" | "member";

export interface User {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/**
 * Tema visual configurable por org_admin (ADR-019): 2 dimensiones deliberadamente, no un
 * sistema de theming completo. `null` en cada campo significa "usar el default de app.css".
 */
export type RadiusPreset = "sharp" | "soft" | "round";
export interface OrganizationTheme {
  accentColor: string | null;
  radiusPreset: RadiusPreset | null;
}

export interface Organization {
  id: string;
  name: string;
  theme: OrganizationTheme;
}

export interface Experiment {
  id: string;
  organizationId: string;
  name: string;
  /** ResourceAttributes["service.name"] emitido por el agente (piezas 1-3) */
  serviceName: string;
  /** Tema de la organización dueña, embebido para que el dashboard no necesite otra llamada (ADR-019). */
  organizationTheme: OrganizationTheme;
}

/**
 * Organización listada en `GET /organizations` (ADR-016): incluye toda organización visible para el
 * usuario, no solo aquellas de las que es org_admin. `myRole` distingue ambos casos para que la UI
 * sepa qué acciones de gestión mostrar (crear experimento, invitar org_admin, ver miembros).
 */
export interface OrganizationSummary extends Organization {
  myRole: OrgRole | null;
}

/** Experimento listado en `GET /experiments` (ADR-016), con el rol resuelto del usuario para esa fila. */
export interface ExperimentSummary extends Experiment {
  myRole: Exclude<ExperimentAccess, null>;
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
  createdAt: string;
}

/** Miembro ya aceptado de una organización o experimento, con sus datos de usuario. */
export interface Member {
  userId: string;
  email: string;
  name: string | null;
  role: OrgRole | ExperimentRole;
}

/**
 * Gráfico custom guardado por un usuario sobre sus propios spans (ADR-027). `definition` es JSON de
 * forma libre a este nivel (validado por el caller con el esquema de `CustomMetricDefinition` del
 * dominio de trazas); la identidad no conoce esa forma, solo la persiste.
 */
export interface CustomMetric {
  id: string;
  experimentId: string;
  name: string;
  definition: Record<string, unknown>;
  createdAt: string;
}

/** Dataset de evaluación offline (ADR-028): una colección curada de ejemplos para un experimento. */
export interface Dataset {
  id: string;
  experimentId: string;
  name: string;
  createdAt: string;
}

/** Una fila de un dataset: qué darle al agente y, opcionalmente, qué esperar de vuelta. */
export interface DatasetItem {
  id: string;
  datasetId: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: Record<string, unknown> | null;
}

/** Metadatos de una ejecución de un dataset contra una versión del agente. Los scores viven en ClickHouse. */
export interface DatasetRun {
  id: string;
  datasetId: string;
  name: string;
  itemCount: number;
  createdAt: string;
}
