import type {
  AlertEventsPageDto,
  AlertRuleDto,
  AlertsOverviewDto,
  AuditPageDto,
  BudgetViewDto,
  ChartCatalogEntryDto,
  CustomMetricDefinitionDto,
  OpenAlertsDto,
  RetentionPolicyDto,
  ScoreConfigDto,
} from "@contract";

/** Puerto de salida: identidad y RBAC (ADR-013). Separado de TraceApi: es otro dominio, otro almacén. */

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** Tema visual de una organización (ADR-019). `null` en un campo = usar el default de app.css. */
export interface OrganizationThemeDto {
  accentColor: string | null;
  radiusPreset: "sharp" | "soft" | "round" | null;
  /** acento cálido secundario (ADR-063) */
  secondaryColor: string | null;
  /** lista cerrada de pilas del sistema; null = Plus Jakarta Sans */
  fontPreset: "system" | "serif" | "humanist" | null;
  /** nombre visible del asistente; null = el del agente */
  assistantName: string | null;
  assistantDefaultMode: "bubble" | "dock" | "fullscreen" | null;
  /** null = todos los modos */
  assistantAllowedModes: Array<"bubble" | "dock" | "fullscreen"> | null;
}

/** Tema sin ningún override: todo cae en los defaults de app.css. */
export const EMPTY_THEME: OrganizationThemeDto = {
  accentColor: null,
  radiusPreset: null,
  secondaryColor: null,
  fontPreset: null,
  assistantName: null,
  assistantDefaultMode: null,
  assistantAllowedModes: null,
};

export interface OrganizationDto {
  id: string;
  name: string;
  /** org_admin si el usuario lo es; null si solo la ve por membership directa en un experimento suyo (ADR-016). */
  myRole: "org_admin" | null;
  /** permisos que le da su rol de organización (ADR-052) */
  permissions: string[];
  theme: OrganizationThemeDto;
}

export interface ExperimentDto {
  id: string;
  organizationId: string;
  name: string;
  serviceName: string;
  /** etiqueta del rol; para decidir qué mostrar, usar `permissions` */
  myRole: string;
  /** permisos efectivos en este experimento: rol de organización + rol de experimento (ADR-052) */
  permissions: string[];
  /** Tema de la organización dueña, embebido para que MainLayout lo aplique sin otra llamada. */
  organizationTheme: OrganizationThemeDto;
}

export interface ApiKeyDto {
  id: string;
  experimentId: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  /** `manual`, o el proveedor de identidad que gestiona esta membresía (ADR-052) */
  source: "manual" | "oidc" | "scim";
}

export interface PendingInvitationDto {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface MembersResponseDto {
  members: MemberDto[];
  pendingInvitations: PendingInvitationDto[];
}

export interface NewScoreConfigInput {
  name: string;
  dataType: ScoreConfigDto["dataType"];
  minValue?: number | null;
  maxValue?: number | null;
  categories?: Array<{ label: string; value: number | null }> | null;
  /** Solo boolean: objetivo de pass rate (0-1) para el dashboard de evaluaciones. */
  targetPassRate?: number | null;
  description?: string | null;
}

export interface ScoreConfigPatchInput {
  description?: string | null;
  minValue?: number;
  maxValue?: number;
  categories?: Array<{ label: string; value: number | null }>;
  targetPassRate?: number | null;
}

/** Gráfico custom guardado por el usuario (ADR-027); su definición usa la misma forma que el query de ClickHouse. */
/** Lo que se envía al crear o cambiar una regla de alerta (ADR-086). */
export type AlertRuleBody = Pick<AlertRuleDto, "name" | "metric" | "customMetricId" | "comparator" | "threshold" | "windowMinutes" | "minSamples" | "reminderMinutes" | "recipients" | "enabled">;

export interface BudgetBody {
  monthlyUsd: number;
  warnPercent: number;
  recipients: string[];
  enabled: boolean;
}

export interface SavedCustomMetricDto {
  id: string;
  name: string;
  definition: CustomMetricDefinitionDto;
  createdAt: string;
}

/** Informe guardado (ADR-035): varios gráficos ya guardados, posicionados en un grid de 12 columnas. */
export interface MetricReportChartDto {
  customMetricId: string;
  name: string;
  definition: CustomMetricDefinitionDto;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MetricReportSummaryDto {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetricReportDto extends MetricReportSummaryDto {
  charts: MetricReportChartDto[];
}

/** Un grupo del proveedor de identidad que da un rol; sin `experimentId` el rol es de toda la organización (ADR-052). */
export interface ExternalMappingDto {
  id: string;
  externalGroup: string;
  experimentId: string | null;
  role: string;
  createdAt: string;
}

export interface ScimTokenDto {
  id: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface OrganizationIdentityDto {
  groupsClaim: string;
  mappings: ExternalMappingDto[];
  scimTokens: ScimTokenDto[];
  scimBaseUrl: string;
}

export interface IdentityApi {
  /** `null` si no hay sesión (401) — nunca lanza para ese caso, es la forma normal de comprobar el login. */
  getMe(signal?: AbortSignal): Promise<CurrentUser | null>;
  listOrganizations(signal?: AbortSignal): Promise<OrganizationDto[]>;
  createOrganization(name: string, signal?: AbortSignal): Promise<OrganizationDto>;
  addOrgAdmin(organizationId: string, email: string, signal?: AbortSignal): Promise<void>;
  listOrgMembers(organizationId: string, signal?: AbortSignal): Promise<MembersResponseDto>;
  updateOrganizationTheme(organizationId: string, theme: OrganizationThemeDto, signal?: AbortSignal): Promise<OrganizationDto>;
  /** Retención de trazas (ADR-084): plazo de la organización y efectivo de cada experimento. Exige `retention:manage`. */
  getRetention(organizationId: string, signal?: AbortSignal): Promise<RetentionPolicyDto>;
  setOrganizationRetention(organizationId: string, days: number, signal?: AbortSignal): Promise<RetentionPolicyDto>;
  /** `days: null` quita el plazo propio del experimento. No puede superar el de la organización. */
  setExperimentRetention(organizationId: string, experimentId: string, days: number | null, signal?: AbortSignal): Promise<RetentionPolicyDto>;
  /** Registro de auditoría de la organización, de más reciente a más antiguo (ADR-084). Exige `audit:read`. */
  listAuditLog(organizationId: string, filter: { action?: string; experimentId?: string; from?: string; to?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<AuditPageDto>;
  /** Valida una exportación y dice cuántas filas tendría, sin descargar ni registrar nada. Lanza si el rango o el tamaño no valen. */
  previewExport(experimentId: string, request: { kind: string; from: string; to: string }, signal?: AbortSignal): Promise<{ rows: number; maxRows: number }>;
  /** Dirección de descarga de una exportación en JSON Lines (ADR-084). Exige `data:export`; el navegador la descarga con su sesión. */
  exportUrl(experimentId: string, request: { kind: string; from: string; to: string }): string;
  /** Identidad externa de la organización: claim de grupos, mapeos y tokens SCIM. Solo org_admin. */
  getOrganizationIdentity(organizationId: string, signal?: AbortSignal): Promise<OrganizationIdentityDto>;
  setGroupsClaim(organizationId: string, groupsClaim: string, signal?: AbortSignal): Promise<void>;
  createExternalMapping(organizationId: string, input: { externalGroup: string; experimentId: string | null; role: string }, signal?: AbortSignal): Promise<ExternalMappingDto>;
  deleteExternalMapping(organizationId: string, mappingId: string, signal?: AbortSignal): Promise<void>;
  /** El campo `plaintext` solo viene relleno aquí. */
  createScimToken(organizationId: string, signal?: AbortSignal): Promise<ScimTokenDto & { plaintext: string }>;
  revokeScimToken(organizationId: string, tokenId: string, signal?: AbortSignal): Promise<void>;
  listExperiments(signal?: AbortSignal): Promise<ExperimentDto[]>;
  /** Crea un experimento, que es un agente (ADR-054): `profile` es su ficha en el catálogo de asistentes. */
  createExperiment(organizationId: string, name: string, serviceName: string, profile?: { description?: string }, signal?: AbortSignal): Promise<ExperimentDto>;
  addExperimentMember(experimentId: string, email: string, role: string, signal?: AbortSignal): Promise<void>;
  listExperimentMembers(experimentId: string, signal?: AbortSignal): Promise<MembersResponseDto>;
  listApiKeys(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto[]>;
  /** El campo `plaintext` solo viene relleno aquí — no se puede volver a consultar después. */
  createApiKey(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto & { plaintext: string }>;
  revokeApiKey(experimentId: string, keyId: string, signal?: AbortSignal): Promise<void>;

  /** Alertas del agente con su estado, historial reciente y presupuesto (ADR-086). Basta `experiment:read`. */
  getAlerts(experimentId: string, signal?: AbortSignal): Promise<AlertsOverviewDto>;
  /** Cambiar reglas y presupuesto exige `alert:manage`. El cuerpo es el mismo al crear y al cambiar: la API dice qué campo falla. */
  createAlertRule(experimentId: string, rule: AlertRuleBody, signal?: AbortSignal): Promise<AlertRuleDto>;
  updateAlertRule(experimentId: string, ruleId: string, rule: AlertRuleBody, signal?: AbortSignal): Promise<AlertRuleDto>;
  deleteAlertRule(experimentId: string, ruleId: string, signal?: AbortSignal): Promise<void>;
  listAlertEvents(experimentId: string, cursor?: string, signal?: AbortSignal): Promise<AlertEventsPageDto>;
  setBudget(experimentId: string, budget: BudgetBody, signal?: AbortSignal): Promise<BudgetViewDto>;
  deleteBudget(experimentId: string, signal?: AbortSignal): Promise<void>;
  /** Alertas disparadas ahora en los agentes que la persona puede leer, para la campana de la barra superior. */
  listOpenAlerts(signal?: AbortSignal): Promise<OpenAlertsDto>;

  /** Gráficos custom guardados del experimento (ADR-027), más recientes primero. */
  listCustomMetrics(experimentId: string, signal?: AbortSignal): Promise<SavedCustomMetricDto[]>;
  createCustomMetric(experimentId: string, name: string, definition: CustomMetricDefinitionDto, signal?: AbortSignal): Promise<SavedCustomMetricDto>;
  deleteCustomMetric(experimentId: string, metricId: string, signal?: AbortSignal): Promise<void>;

  /** Catálogo de datos de las Custom charts (ADR-078): los nombres de negocio y la visibilidad de pasos y atributos. Solo las ediciones. */
  listChartCatalog(experimentId: string, signal?: AbortSignal): Promise<ChartCatalogEntryDto[]>;
  /** Pone nombre o visibilidad a un paso o atributo. Sin nombre y en automático vuelve al valor por defecto y devuelve null. Exige `catalog:manage`. */
  saveChartCatalogEntry(
    experimentId: string,
    entry: { kind: "step" | "attribute"; key: string; displayName: string | null; visibility?: "auto" | "shown" | "hidden" },
    signal?: AbortSignal,
  ): Promise<ChartCatalogEntryDto | null>;
  /** Vuelve a automático el nombre y la visibilidad. */
  deleteChartCatalogEntry(experimentId: string, kind: "step" | "attribute", key: string, signal?: AbortSignal): Promise<void>;

  /** Score configs (ADR-036): rúbricas de anotación. Crear/editar/archivar exige admin del experimento. */
  listScoreConfigs(experimentId: string, includeArchived?: boolean, signal?: AbortSignal): Promise<ScoreConfigDto[]>;
  createScoreConfig(experimentId: string, input: NewScoreConfigInput, signal?: AbortSignal): Promise<ScoreConfigDto>;
  updateScoreConfig(experimentId: string, configId: string, patch: ScoreConfigPatchInput, signal?: AbortSignal): Promise<ScoreConfigDto>;
  archiveScoreConfig(experimentId: string, configId: string, signal?: AbortSignal): Promise<ScoreConfigDto>;
  unarchiveScoreConfig(experimentId: string, configId: string, signal?: AbortSignal): Promise<ScoreConfigDto>;

  /** Informes guardados del experimento (ADR-035): agrupan varios gráficos ya guardados en un grid. */
  listMetricReports(experimentId: string, signal?: AbortSignal): Promise<MetricReportSummaryDto[]>;
  createMetricReport(experimentId: string, name: string, signal?: AbortSignal): Promise<MetricReportSummaryDto>;
  getMetricReport(experimentId: string, reportId: string, signal?: AbortSignal): Promise<MetricReportDto>;
  renameMetricReport(experimentId: string, reportId: string, name: string, signal?: AbortSignal): Promise<MetricReportDto>;
  deleteMetricReport(experimentId: string, reportId: string, signal?: AbortSignal): Promise<void>;
  setMetricReportCharts(experimentId: string, reportId: string, charts: Array<{ customMetricId: string; x: number; y: number; w: number; h: number }>, signal?: AbortSignal): Promise<MetricReportDto>;
  sendMetricReportEmail(experimentId: string, reportId: string, toEmails: string[], signal?: AbortSignal): Promise<void>;
}
