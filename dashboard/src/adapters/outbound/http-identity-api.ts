import type { AlertEventsPageDto, AlertRuleDto, AlertsOverviewDto, AuditPageDto, BudgetViewDto, ChartCatalogEntryDto, CustomMetricDefinitionDto, OpenAlertsDto, RetentionPolicyDto, ScoreConfigDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import type {
  AlertRuleBody,
  ApiKeyDto,
  BudgetBody,
  CurrentUser,
  ExperimentDto,
  ExternalMappingDto,
  IdentityApi,
  MembersResponseDto,
  MetricReportDto,
  MetricReportSummaryDto,
  NewScoreConfigInput,
  OrganizationDto,
  OrganizationIdentityDto,
  OrganizationThemeDto,
  ScimTokenDto,
  SavedCustomMetricDto,
  ScoreConfigPatchInput,
} from "@/application/identity-api";

type Fetch = typeof fetch;

/** Adapter HTTP del puerto IdentityApi contra `/api/v1` (ADR-013). */
export class HttpIdentityApi implements IdentityApi {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  async getMe(signal?: AbortSignal): Promise<CurrentUser | null> {
    const response = await this.fetchFn(`${this.baseUrl}/me`, { signal, headers: { Accept: "application/json" } });
    if (response.status === 401) return null;
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as CurrentUser;
  }

  async listOrganizations(signal?: AbortSignal): Promise<OrganizationDto[]> {
    const { items } = await this.get<{ items: OrganizationDto[] }>("/organizations", signal);
    return items;
  }

  createOrganization(name: string, signal?: AbortSignal): Promise<OrganizationDto> {
    return this.post<OrganizationDto>("/organizations", { name }, signal);
  }

  async addOrgAdmin(organizationId: string, email: string, signal?: AbortSignal): Promise<void> {
    await this.post(`/organizations/${encodeURIComponent(organizationId)}/members`, { email }, signal);
  }

  listOrgMembers(organizationId: string, signal?: AbortSignal): Promise<MembersResponseDto> {
    return this.get(`/organizations/${encodeURIComponent(organizationId)}/members`, signal);
  }

  updateOrganizationTheme(organizationId: string, theme: OrganizationThemeDto, signal?: AbortSignal): Promise<OrganizationDto> {
    return this.patch(`/organizations/${encodeURIComponent(organizationId)}/theme`, theme, signal);
  }

  getAlerts(experimentId: string, signal?: AbortSignal): Promise<AlertsOverviewDto> {
    return this.get(`/experiments/${encodeURIComponent(experimentId)}/alerts`, signal);
  }

  createAlertRule(experimentId: string, rule: AlertRuleBody, signal?: AbortSignal): Promise<AlertRuleDto> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/alerts`, rule, signal);
  }

  updateAlertRule(experimentId: string, ruleId: string, rule: AlertRuleBody, signal?: AbortSignal): Promise<AlertRuleDto> {
    return this.put(`/experiments/${encodeURIComponent(experimentId)}/alerts/${encodeURIComponent(ruleId)}`, rule, signal);
  }

  async deleteAlertRule(experimentId: string, ruleId: string, signal?: AbortSignal): Promise<void> {
    await this.remove(`/experiments/${encodeURIComponent(experimentId)}/alerts/${encodeURIComponent(ruleId)}`, signal);
  }

  listAlertEvents(experimentId: string, cursor?: string, signal?: AbortSignal): Promise<AlertEventsPageDto> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.get(`/experiments/${encodeURIComponent(experimentId)}/alerts/events${query}`, signal);
  }

  setBudget(experimentId: string, budget: BudgetBody, signal?: AbortSignal): Promise<BudgetViewDto> {
    return this.put(`/experiments/${encodeURIComponent(experimentId)}/budget`, budget, signal);
  }

  async deleteBudget(experimentId: string, signal?: AbortSignal): Promise<void> {
    await this.remove(`/experiments/${encodeURIComponent(experimentId)}/budget`, signal);
  }

  listOpenAlerts(signal?: AbortSignal): Promise<OpenAlertsDto> {
    return this.get("/alerts/open", signal);
  }

  getRetention(organizationId: string, signal?: AbortSignal): Promise<RetentionPolicyDto> {
    return this.get(`/organizations/${encodeURIComponent(organizationId)}/retention`, signal);
  }

  setOrganizationRetention(organizationId: string, days: number, signal?: AbortSignal): Promise<RetentionPolicyDto> {
    return this.put(`/organizations/${encodeURIComponent(organizationId)}/retention`, { days }, signal);
  }

  setExperimentRetention(organizationId: string, experimentId: string, days: number | null, signal?: AbortSignal): Promise<RetentionPolicyDto> {
    return this.put(`/organizations/${encodeURIComponent(organizationId)}/experiments/${encodeURIComponent(experimentId)}/retention`, { days }, signal);
  }

  listAuditLog(organizationId: string, filter: { action?: string; experimentId?: string; from?: string; to?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<AuditPageDto> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") params.set(key, String(value));
    const query = params.toString();
    return this.get(`/organizations/${encodeURIComponent(organizationId)}/audit${query ? `?${query}` : ""}`, signal);
  }

  previewExport(experimentId: string, request: { kind: string; from: string; to: string }, signal?: AbortSignal): Promise<{ rows: number; maxRows: number }> {
    const params = new URLSearchParams({ kind: request.kind, from: request.from, to: request.to, dryRun: "1" });
    return this.get(`/experiments/${encodeURIComponent(experimentId)}/export?${params.toString()}`, signal);
  }

  exportUrl(experimentId: string, request: { kind: string; from: string; to: string }): string {
    const params = new URLSearchParams({ kind: request.kind, from: request.from, to: request.to });
    return `${this.baseUrl}/experiments/${encodeURIComponent(experimentId)}/export?${params.toString()}`;
  }

  getOrganizationIdentity(organizationId: string, signal?: AbortSignal): Promise<OrganizationIdentityDto> {
    return this.get(`/organizations/${encodeURIComponent(organizationId)}/identity`, signal);
  }

  async setGroupsClaim(organizationId: string, groupsClaim: string, signal?: AbortSignal): Promise<void> {
    await this.patch(`/organizations/${encodeURIComponent(organizationId)}/identity`, { groupsClaim }, signal);
  }

  createExternalMapping(organizationId: string, input: { externalGroup: string; experimentId: string | null; role: string }, signal?: AbortSignal): Promise<ExternalMappingDto> {
    return this.post(`/organizations/${encodeURIComponent(organizationId)}/identity/mappings`, input, signal);
  }

  async deleteExternalMapping(organizationId: string, mappingId: string, signal?: AbortSignal): Promise<void> {
    await this.remove(`/organizations/${encodeURIComponent(organizationId)}/identity/mappings/${encodeURIComponent(mappingId)}`, signal);
  }

  createScimToken(organizationId: string, signal?: AbortSignal): Promise<ScimTokenDto & { plaintext: string }> {
    return this.post(`/organizations/${encodeURIComponent(organizationId)}/identity/scim-tokens`, {}, signal);
  }

  async revokeScimToken(organizationId: string, tokenId: string, signal?: AbortSignal): Promise<void> {
    await this.remove(`/organizations/${encodeURIComponent(organizationId)}/identity/scim-tokens/${encodeURIComponent(tokenId)}`, signal);
  }

  private async remove(path: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, { method: "DELETE", signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw await toApiError(response);
  }

  async listExperiments(signal?: AbortSignal): Promise<ExperimentDto[]> {
    const { items } = await this.get<{ items: ExperimentDto[] }>("/experiments", signal);
    return items;
  }

  createExperiment(organizationId: string, name: string, serviceName: string, profile: { description?: string } = {}, signal?: AbortSignal): Promise<ExperimentDto> {
    return this.post<ExperimentDto>(`/organizations/${encodeURIComponent(organizationId)}/experiments`, { name, serviceName, ...profile }, signal);
  }

  async addExperimentMember(experimentId: string, email: string, role: string, signal?: AbortSignal): Promise<void> {
    await this.post(`/experiments/${encodeURIComponent(experimentId)}/members`, { email, role }, signal);
  }

  listExperimentMembers(experimentId: string, signal?: AbortSignal): Promise<MembersResponseDto> {
    return this.get(`/experiments/${encodeURIComponent(experimentId)}/members`, signal);
  }

  async listApiKeys(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto[]> {
    const { items } = await this.get<{ items: ApiKeyDto[] }>(`/experiments/${encodeURIComponent(experimentId)}/api-keys`, signal);
    return items;
  }

  createApiKey(experimentId: string, signal?: AbortSignal): Promise<ApiKeyDto & { plaintext: string }> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/api-keys`, {}, signal);
  }

  async revokeApiKey(experimentId: string, keyId: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/experiments/${encodeURIComponent(experimentId)}/api-keys/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw await toApiError(response);
  }

  async listCustomMetrics(experimentId: string, signal?: AbortSignal): Promise<SavedCustomMetricDto[]> {
    const { items } = await this.get<{ items: SavedCustomMetricDto[] }>(`/experiments/${encodeURIComponent(experimentId)}/custom-metrics`, signal);
    return items;
  }

  createCustomMetric(experimentId: string, name: string, definition: CustomMetricDefinitionDto, signal?: AbortSignal): Promise<SavedCustomMetricDto> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/custom-metrics`, { name, definition }, signal);
  }

  async deleteCustomMetric(experimentId: string, metricId: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchFn(
      `${this.baseUrl}/experiments/${encodeURIComponent(experimentId)}/custom-metrics/${encodeURIComponent(metricId)}`,
      { method: "DELETE", signal, headers: { Accept: "application/json" } },
    );
    if (!response.ok) throw await toApiError(response);
  }

  async listChartCatalog(experimentId: string, signal?: AbortSignal): Promise<ChartCatalogEntryDto[]> {
    const { items } = await this.get<{ items: ChartCatalogEntryDto[] }>(`/experiments/${encodeURIComponent(experimentId)}/chart-catalog`, signal);
    return items;
  }

  async saveChartCatalogEntry(
    experimentId: string,
    entry: { kind: "step" | "attribute"; key: string; displayName: string | null; visibility?: "auto" | "shown" | "hidden" },
    signal?: AbortSignal,
  ): Promise<ChartCatalogEntryDto | null> {
    const { entry: saved } = await this.put<{ entry: ChartCatalogEntryDto | null }>(`/experiments/${encodeURIComponent(experimentId)}/chart-catalog`, entry, signal);
    return saved;
  }

  async deleteChartCatalogEntry(experimentId: string, kind: "step" | "attribute", key: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchFn(
      `${this.baseUrl}/experiments/${encodeURIComponent(experimentId)}/chart-catalog?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`,
      { method: "DELETE", signal, headers: { Accept: "application/json" } },
    );
    if (!response.ok) throw await toApiError(response);
  }

  async listScoreConfigs(experimentId: string, includeArchived = false, signal?: AbortSignal): Promise<ScoreConfigDto[]> {
    const { items } = await this.get<{ items: ScoreConfigDto[] }>(`/experiments/${encodeURIComponent(experimentId)}/score-configs?includeArchived=${includeArchived}`, signal);
    return items;
  }

  createScoreConfig(experimentId: string, input: NewScoreConfigInput, signal?: AbortSignal): Promise<ScoreConfigDto> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/score-configs`, input, signal);
  }

  updateScoreConfig(experimentId: string, configId: string, patch: ScoreConfigPatchInput, signal?: AbortSignal): Promise<ScoreConfigDto> {
    return this.patch(`/experiments/${encodeURIComponent(experimentId)}/score-configs/${encodeURIComponent(configId)}`, patch, signal);
  }

  archiveScoreConfig(experimentId: string, configId: string, signal?: AbortSignal): Promise<ScoreConfigDto> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/score-configs/${encodeURIComponent(configId)}/archive`, {}, signal);
  }

  unarchiveScoreConfig(experimentId: string, configId: string, signal?: AbortSignal): Promise<ScoreConfigDto> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/score-configs/${encodeURIComponent(configId)}/unarchive`, {}, signal);
  }

  async listMetricReports(experimentId: string, signal?: AbortSignal): Promise<MetricReportSummaryDto[]> {
    const { items } = await this.get<{ items: MetricReportSummaryDto[] }>(`/experiments/${encodeURIComponent(experimentId)}/reports`, signal);
    return items;
  }

  createMetricReport(experimentId: string, name: string, signal?: AbortSignal): Promise<MetricReportSummaryDto> {
    return this.post(`/experiments/${encodeURIComponent(experimentId)}/reports`, { name }, signal);
  }

  getMetricReport(experimentId: string, reportId: string, signal?: AbortSignal): Promise<MetricReportDto> {
    return this.get(`/experiments/${encodeURIComponent(experimentId)}/reports/${encodeURIComponent(reportId)}`, signal);
  }

  renameMetricReport(experimentId: string, reportId: string, name: string, signal?: AbortSignal): Promise<MetricReportDto> {
    return this.patch(`/experiments/${encodeURIComponent(experimentId)}/reports/${encodeURIComponent(reportId)}`, { name }, signal);
  }

  async deleteMetricReport(experimentId: string, reportId: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}/experiments/${encodeURIComponent(experimentId)}/reports/${encodeURIComponent(reportId)}`, {
      method: "DELETE",
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw await toApiError(response);
  }

  setMetricReportCharts(
    experimentId: string,
    reportId: string,
    charts: Array<{ customMetricId: string; x: number; y: number; w: number; h: number }>,
    signal?: AbortSignal,
  ): Promise<MetricReportDto> {
    return this.put(`/experiments/${encodeURIComponent(experimentId)}/reports/${encodeURIComponent(reportId)}/charts`, { charts }, signal);
  }

  async sendMetricReportEmail(experimentId: string, reportId: string, toEmails: string[], signal?: AbortSignal): Promise<void> {
    await this.post(`/experiments/${encodeURIComponent(experimentId)}/reports/${encodeURIComponent(reportId)}/send`, { toEmails }, signal);
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, { signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "POST",
      signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  private async patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "PATCH",
      signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  private async put<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "PUT",
      signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as { title?: string; detail?: string; errors?: Record<string, string> };
    return new ApiError(response.status, problem.title ?? response.statusText, problem.detail, problem.errors);
  } catch {
    return new ApiError(response.status, response.statusText || "Error", undefined);
  }
}
