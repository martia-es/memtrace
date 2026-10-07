import type { AccessGrantDto, AssistantPersonDto, AssistantCardDto, ChatResponseDto, ConnectionDto, ConnectionKindDto, ConnectionStatusDto, DeployPreviewDto, DeployRunDto, DeploymentDto, EnvironmentDto, HealthCheckDto } from "@contract";
import type { AssistantApi, AssistantPatchInput, DeploymentInput, NewGrantInput } from "@/application/assistant-api";
import { ApiError } from "@/application/trace-api";

type Fetch = typeof fetch;
const e = encodeURIComponent;

/** Adapter HTTP del puerto AssistantApi contra `/api/v1` (ADR-053). */
export class HttpAssistantApi implements AssistantApi {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  async listCatalog(organizationId: string, signal?: AbortSignal): Promise<AssistantCardDto[]> {
    return (await this.request<{ items: AssistantCardDto[] }>("GET", `/organizations/${e(organizationId)}/assistants`, undefined, signal)).items;
  }
  getAssistant(experimentId: string, signal?: AbortSignal): Promise<AssistantCardDto> {
    return this.request("GET", this.assistant(experimentId), undefined, signal);
  }
  updateAssistant(experimentId: string, patch: AssistantPatchInput, signal?: AbortSignal): Promise<AssistantCardDto> {
    return this.request("PATCH", this.assistant(experimentId), patch, signal);
  }

  async listEnvironments(experimentId: string, signal?: AbortSignal): Promise<EnvironmentDto[]> {
    return (await this.request<{ items: EnvironmentDto[] }>("GET", `${this.assistant(experimentId)}/environments`, undefined, signal)).items;
  }
  createDeployment(experimentId: string, environmentKey: string, input: DeploymentInput, signal?: AbortSignal): Promise<DeploymentDto> {
    return this.request("POST", `${this.assistant(experimentId)}/deployments`, { environmentKey, ...input }, signal);
  }
  updateDeployment(experimentId: string, deploymentId: string, patch: Partial<DeploymentInput>, signal?: AbortSignal): Promise<DeploymentDto> {
    return this.request("PATCH", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}`, patch, signal);
  }
  async deleteDeployment(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}`, undefined, signal);
  }
  chat(experimentId: string, deploymentId: string, message: string, sessionId: string | null, signal?: AbortSignal): Promise<ChatResponseDto> {
    return this.request("POST", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/chat`, { message, sessionId }, signal);
  }
  async sendFeedback(experimentId: string, traceId: string, rating: 1 | -1, signal?: AbortSignal): Promise<void> {
    await this.request("POST", `/api/v1/experiments/${e(experimentId)}/traces/${e(traceId)}/feedback`, { rating }, signal);
  }
  previewDeploy(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<DeployPreviewDto> {
    return this.request("GET", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/deploy`, undefined, signal);
  }
  deploy(experimentId: string, deploymentId: string, bypassReason: string | null, signal?: AbortSignal): Promise<DeployRunDto> {
    return this.request("POST", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/deploy`, { bypassReason }, signal);
  }
  async listDeploys(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<DeployRunDto[]> {
    return (await this.request<{ items: DeployRunDto[] }>("GET", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/deploys?limit=5`, undefined, signal)).items;
  }
  checkDeploymentNow(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<DeploymentDto> {
    return this.request("POST", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/health/check`, undefined, signal);
  }
  async getHealthHistory(experimentId: string, deploymentId: string, hours: number, signal?: AbortSignal): Promise<HealthCheckDto[]> {
    return (await this.request<{ items: HealthCheckDto[] }>("GET", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/health?hours=${hours}`, undefined, signal)).items;
  }

  async listGrants(experimentId: string, deploymentId: string, signal?: AbortSignal): Promise<AccessGrantDto[]> {
    return (await this.request<{ items: AccessGrantDto[] }>("GET", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/access`, undefined, signal)).items;
  }
  addGrant(experimentId: string, deploymentId: string, input: NewGrantInput, signal?: AbortSignal): Promise<AccessGrantDto> {
    return this.request("POST", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/access`, input, signal);
  }
  async searchPeople(experimentId: string, query: string, signal?: AbortSignal): Promise<AssistantPersonDto[]> {
    return (await this.request<{ items: AssistantPersonDto[] }>("GET", `${this.assistant(experimentId)}/people?q=${e(query)}`, undefined, signal)).items;
  }
  async removeGrant(experimentId: string, deploymentId: string, grantId: string, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `${this.assistant(experimentId)}/deployments/${e(deploymentId)}/access/${e(grantId)}`, undefined, signal);
  }

  async listConnections(experimentId: string, signal?: AbortSignal): Promise<ConnectionDto[]> {
    return (await this.request<{ items: ConnectionDto[] }>("GET", `${this.assistant(experimentId)}/connections`, undefined, signal)).items;
  }
  declareConnection(experimentId: string, input: { kind: ConnectionKindDto; name: string; via?: string | null }, signal?: AbortSignal): Promise<ConnectionDto> {
    return this.request("POST", `${this.assistant(experimentId)}/connections`, input, signal);
  }
  decideConnection(experimentId: string, connectionId: string, status: ConnectionStatusDto, note: string | null, signal?: AbortSignal): Promise<ConnectionDto> {
    return this.request("PATCH", `${this.assistant(experimentId)}/connections/${e(connectionId)}`, { status, note }, signal);
  }
  async undeclareConnection(experimentId: string, connectionId: string, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `${this.assistant(experimentId)}/connections/${e(connectionId)}`, undefined, signal);
  }
  syncConnections(experimentId: string, signal?: AbortSignal): Promise<{ observed: number }> {
    return this.request("POST", `${this.assistant(experimentId)}/connections/sync`, undefined, signal);
  }

  private assistant(experimentId: string): string {
    return `/experiments/${e(experimentId)}/assistant`;
  }

  private async request<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      signal,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw await toApiError(response);
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
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
