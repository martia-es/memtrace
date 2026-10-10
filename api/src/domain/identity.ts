/** Modelo de identidad y RBAC de 2 niveles (ADR-013): Organización -> Experimento. */

import type { Permission } from "./permissions";

export type OrgRole = "org_admin";
/** Nombre de un rol de experimento (`technical`, `business`, o uno propio): los roles son datos (ADR-052). */
export type ExperimentRole = string;

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
export type FontPreset = "system" | "serif" | "humanist";
/** Formas de ver el asistente (ADR-063): burbuja flotante, panel lateral o pantalla completa en una pestaña nueva. */
export type AssistantDisplayMode = "bubble" | "dock" | "fullscreen";
export const ASSISTANT_DISPLAY_MODES: readonly AssistantDisplayMode[] = ["bubble", "dock", "fullscreen"];
export interface OrganizationTheme {
  accentColor: string | null;
  radiusPreset: RadiusPreset | null;
  /** acento cálido secundario (resaltados); null = el de MemTrace (ADR-063) */
  secondaryColor: string | null;
  /** lista cerrada de pilas del sistema, sin cargar fuentes externas; null = Plus Jakarta Sans */
  fontPreset: FontPreset | null;
  /** nombre visible del asistente en el chat; null = el del agente */
  assistantName: string | null;
  /** modo por defecto y modos permitidos; null = burbuja y todos los modos */
  assistantDefaultMode: AssistantDisplayMode | null;
  assistantAllowedModes: AssistantDisplayMode[] | null;
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
  /** permisos que le da su rol de organización (ADR-052) */
  permissions: Permission[];
}

/** Experimento listado en `GET /experiments` (ADR-016), con el rol resuelto del usuario para esa fila. */
export interface ExperimentSummary extends Experiment {
  /** etiqueta del rol (la del experimento si la tiene; si no, `org_admin`); la UI decide por `permissions`, no por esto */
  myRole: string;
  /** unión de los permisos de su rol de organización y de su rol de experimento (ADR-052) */
  permissions: Permission[];
}

/**
 * Acceso resuelto de un usuario a un experimento concreto: unión de los permisos de su rol de organización y de
 * su rol de experimento (ADR-052). `role` es solo una etiqueta; `null` si no tiene ningún rol que lo alcance.
 */
export type ExperimentAccess = {
  role: string;
  permissions: Permission[];
  /** el acceso viene solo de un grant de consultora (ADR-091): se deja constancia en la auditoría */
  viaPartner?: boolean;
} | null;

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
  /** `manual`, o el proveedor de identidad que la gestiona (ADR-052): esas no se editan a mano */
  source: "manual" | "oidc" | "scim";
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

/** Informe guardado por experimento: agrupa varias `custom_metrics` en un grid (ADR-033). */
export interface MetricReport {
  id: string;
  experimentId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Posición/tamaño de un gráfico dentro del grid de 12 columnas de un informe. */
export interface MetricReportChartLayout {
  customMetricId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Un informe con sus gráficos resueltos (nombre + definición), listo para render o para el email. */
export interface MetricReportWithCharts extends MetricReport {
  charts: Array<MetricReportChartLayout & { name: string; definition: Record<string, unknown> }>;
}

/** Dataset de evaluación offline (ADR-028): una colección curada de ejemplos para un experimento. */
export interface Dataset {
  id: string;
  experimentId: string;
  name: string;
  createdAt: string;
}

/** Una foto fija inmutable de los items de un dataset (ADR-031/ADR-032): se crea automáticamente
 * en cada alta/edición/borrado de item, nunca a mano. `major` sube al añadir o borrar un item
 * (cambio estructural); `minor` sube al editar el contenido de uno existente. Un `DatasetRun`
 * siempre queda fijado a una versión concreta, para seguir siendo reproducible aunque el dataset
 * siga cambiando después. */
export interface DatasetVersion {
  id: string;
  datasetId: string;
  major: number;
  minor: number;
  /** Descripción generada del cambio que produjo esta versión (p. ej. "Added item"). */
  note: string | null;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
}

/** Una fila de una versión de dataset: qué darle al agente y, opcionalmente, qué esperar de vuelta.
 * `createdBy`/`createdAt` son del momento en que el item se dio de alta por primera vez (se
 * preservan al clonarse a versiones posteriores); `updatedBy`/`updatedAt` reflejan su última
 * edición de contenido, si la ha tenido (ADR-032). */
export interface DatasetItem {
  id: string;
  /** Identidad estable del item entre versiones (ADR-033): `id` de la fila con la que nació. */
  originItemId: string;
  datasetVersionId: string;
  input: unknown;
  expectedOutput: unknown;
  metadata: Record<string, unknown> | null;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  updatedBy: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
  /** Si no es null, este item es un tombstone (ADR-032 follow-up): vive solo en la versión en la
   * que se borró, preservando su contenido y autoría original para dejar constancia de quién lo
   * borró y cuándo. `listDatasetItems` lo filtra de la vista "items actuales". */
  deletedBy: string | null;
  deletedByEmail: string | null;
  deletedAt: string | null;
}

/** Metadatos de una ejecución de una versión de dataset contra una versión del agente. Los scores viven en ClickHouse. */
export type DatasetRunStatus = "running" | "completed";

export interface DatasetRun {
  id: string;
  datasetId: string;
  datasetVersionId: string;
  versionMajor: number;
  versionMinor: number;
  name: string;
  itemCount: number;
  /** `running` mientras el SDK sigue subiendo items por lotes (o si el proceso murió a medias), ADR-034. */
  status: DatasetRunStatus;
  createdAt: string;
  /** commit del código que se evaluó (ADR-065); null = versión desconocida */
  revision: string | null;
  /** el árbol tenía cambios sin commitear; null = no se sabe (el commit vino del CI) */
  revisionDirty: boolean | null;
}

/** Commit evaluado, tal como lo manda el SDK al abrir un run. */
export interface RunRevision {
  sha: string;
  dirty: boolean | null;
}

/** Una fila de la vista global de runs (ADR-031): igual que `DatasetRun`, con el nombre del
 * dataset ya resuelto para no obligar al dashboard a cruzarlo con `listDatasets`. */
export interface DatasetRunWithDataset extends DatasetRun {
  datasetName: string;
}
