import { ApiError } from "@/application/trace-api";
import type { ApiKeyDto, CurrentUser, ExperimentDto, IdentityApi, MembersResponseDto, OrganizationDto } from "@/application/identity-api";

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
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as { title?: string; detail?: string; errors?: Record<string, string> };
    return new ApiError(response.status, problem.title ?? response.statusText, problem.detail, problem.errors);
  } catch {
    return new ApiError(response.status, response.statusText || "Error", undefined);
  }
}
