import type { CustomMetricDefinitionDto, ScoreConfigDto } from "@contract";
import { ApiError } from "@/application/trace-api";
import type {
  ApiKeyDto,
  CurrentUser,
  ExperimentDto,
  IdentityApi,
  MembersResponseDto,
  MetricReportDto,
  MetricReportSummaryDto,
  NewScoreConfigInput,
  OrganizationDto,
  OrganizationThemeDto,
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

  async listExperiments(signal?: AbortSignal): Promise<ExperimentDto[]> {
    const { items } = await this.get<{ items: ExperimentDto[] }>("/experiments", signal);
    return items;
  }

  createExperiment(organizationId: string, name: string, serviceName: string, signal?: AbortSignal): Promise<ExperimentDto> {
    return this.post<ExperimentDto>(`/organizations/${encodeURIComponent(organizationId)}/experiments`, { name, serviceName }, signal);
  }

  async addExperimentMember(experimentId: string, email: string, role: "admin" | "member", signal?: AbortSignal): Promise<void> {
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
