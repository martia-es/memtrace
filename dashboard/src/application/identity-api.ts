import type { CustomMetricDefinitionDto, ScoreConfigDto } from "@contract";

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
}

export interface OrganizationDto {
  id: string;
  name: string;
  /** org_admin si el usuario lo es; null si solo la ve por membership directa en un experimento suyo (ADR-016). */
  myRole: "org_admin" | null;
  theme: OrganizationThemeDto;
}

export interface ExperimentDto {
  id: string;
  organizationId: string;
  name: string;
  serviceName: string;
  myRole: "org_admin" | "admin" | "member";
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
  role: "org_admin" | "admin" | "member";
}

export interface PendingInvitationDto {
  id: string;
  email: string;
  role: "org_admin" | "admin" | "member";
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
  description?: string | null;
}

export interface ScoreConfigPatchInput {
  description?: string | null;
  minValue?: number;
  maxValue?: number;
  categories?: Array<{ label: string; value: number | null }>;
}

/** Gráfico custom guardado por el usuario (ADR-027); su definición usa la misma forma que el query de ClickHouse. */
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

export interface IdentityApi {
  /** `null` si no hay sesión (401) — nunca lanza para ese caso, es la forma normal de comprobar el login. */
  getMe(signal?: AbortSignal): Promise<CurrentUser | null>;
  listOrganizations(signal?: AbortSignal): Promise<OrganizationDto[]>;
  createOrganization(name: string, signal?: AbortSignal): Promise<OrganizationDto>;
  addOrgAdmin(organizationId: string, email: string, signal?: AbortSignal): Promise<void>;
  listOrgMembers(organizationId: string, signal?: AbortSignal): Promise<MembersResponseDto>;
  updateOrganizationTheme(organizationId: string, theme: OrganizationThemeDto, signal?: AbortSignal): Promise<OrganizationDto>;
  listExperiments(signal?: AbortSignal): Promise<ExperimentDto[]>;
  createExperiment(organizationId: string, name: string, serviceName: string, signal?: AbortSignal): Promise<ExperimentDto>;
  addExperimentMember(experimentId: string, email: string, role: "admin" | "member", signal?: AbortSignal): Promise<void>;
  listExperimentMembers(experimentId: string, signal?: AbortSignal): Promise<MembersResponseDto>;
  listApiKeys(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto[]>;
  /** El campo `plaintext` solo viene relleno aquí — no se puede volver a consultar después. */
  createApiKey(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto & { plaintext: string }>;
  revokeApiKey(experimentId: string, keyId: string, signal?: AbortSignal): Promise<void>;

  /** Gráficos custom guardados del experimento (ADR-027), más recientes primero. */
  listCustomMetrics(experimentId: string, signal?: AbortSignal): Promise<SavedCustomMetricDto[]>;
  createCustomMetric(experimentId: string, name: string, definition: CustomMetricDefinitionDto, signal?: AbortSignal): Promise<SavedCustomMetricDto>;
  deleteCustomMetric(experimentId: string, metricId: string, signal?: AbortSignal): Promise<void>;

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
