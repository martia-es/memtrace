import type { ApprovalRequestDto, ApprovalRuleDto, ApprovalRulesResponse, PromptApprovalsResponse, PromptDetailDto, PromptEvidenceResponse, PromptGateDto, PromptMapDto, PromptListResponse, PromptPlaygroundResponse, PromptPolicyDto, PromptSummaryDto, PromptTagEventDto, PromptVersionDto } from "@contract";
import type { ApprovalScope, NewPromptInput, OpenApprovalInput, PromptApi } from "@/application/prompt-api";
import { ApiError } from "@/application/trace-api";

type Fetch = typeof fetch;
const e = encodeURIComponent;

/** Adapter HTTP del puerto PromptApi contra `/api/v1` (ADR-067). */
export class HttpPromptApi implements PromptApi {
  constructor(
    private readonly baseUrl = "/api/v1",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  async listForAgent(experimentId: string, includeArchived: boolean, signal?: AbortSignal): Promise<PromptSummaryDto[]> {
    const query = includeArchived ? "?archived=true" : "";
    return (await this.request<PromptListResponse>("GET", `/experiments/${e(experimentId)}/prompts${query}`, undefined, signal)).items;
  }
  create(experimentId: string, input: NewPromptInput, signal?: AbortSignal): Promise<PromptDetailDto> {
    return this.request("POST", `/experiments/${e(experimentId)}/prompts`, input, signal);
  }
  get(promptId: string, signal?: AbortSignal): Promise<PromptDetailDto> {
    return this.request("GET", `/prompts/${e(promptId)}`, undefined, signal);
  }
  update(promptId: string, patch: { description?: string; archived?: boolean; experimentIds?: string[] }, signal?: AbortSignal): Promise<PromptDetailDto> {
    return this.request("PATCH", `/prompts/${e(promptId)}`, patch, signal);
  }
  saveVersion(
    promptId: string,
    input: { content: string; message: string; parentVersion?: number | null; draft?: boolean; origin?: { traceIds: string[]; cause: string | null; rationale: string } | null },
    signal?: AbortSignal,
  ): Promise<PromptVersionDto> {
    return this.request("POST", `/prompts/${e(promptId)}/versions`, input, signal);
  }
  rebuild(promptId: string, signal?: AbortSignal): Promise<PromptVersionDto> {
    return this.request("POST", `/prompts/${e(promptId)}/rebuild`, undefined, signal);
  }
  rebuildDependents(promptId: string, signal?: AbortSignal): Promise<{ created: Array<{ promptId: string; name: string; version: number }>; skipped: Array<{ promptId: string; name: string; reason: string }> }> {
    return this.request("POST", `/prompts/${e(promptId)}/rebuild-dependents`, undefined, signal);
  }
  publishDraft(promptId: string, version: number, signal?: AbortSignal): Promise<PromptVersionDto> {
    return this.request("POST", `/prompts/${e(promptId)}/versions/${version}/publish`, undefined, signal);
  }
  async discardDraft(promptId: string, version: number, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `/prompts/${e(promptId)}/versions/${version}`, undefined, signal);
  }
  getEvidence(experimentId: string, promptId: string, range: { from: Date; to: Date }, signal?: AbortSignal): Promise<PromptEvidenceResponse> {
    const query = `?from=${e(range.from.toISOString())}&to=${e(range.to.toISOString())}`;
    return this.request("GET", `/experiments/${e(experimentId)}/prompts/${e(promptId)}/evidence${query}`, undefined, signal);
  }
  moveTag(promptId: string, tag: string, version: number | null, reason: string, bypassReason: string | null = null, signal?: AbortSignal): Promise<PromptTagEventDto> {
    return this.request("PUT", `/prompts/${e(promptId)}/tags/${e(tag)}`, { version, reason, bypassReason }, signal);
  }
  runPlayground(experimentId: string, promptId: string, input: { deploymentId: string; version: number; message: string; history?: string[] }, signal?: AbortSignal): Promise<PromptPlaygroundResponse> {
    return this.request("POST", `/experiments/${e(experimentId)}/prompts/${e(promptId)}/playground`, input, signal);
  }
  previewGate(promptId: string, tag: string, version: number, signal?: AbortSignal): Promise<PromptGateDto> {
    return this.request("GET", `/prompts/${e(promptId)}/gate?tag=${e(tag)}&version=${version}`, undefined, signal);
  }
  map(promptId: string, move?: { tag: string; version: number }, signal?: AbortSignal): Promise<PromptMapDto> {
    const query = move ? `?tag=${e(move.tag)}&version=${move.version}` : "";
    return this.request("GET", `/prompts/${e(promptId)}/map${query}`, undefined, signal);
  }
  setPolicy(promptId: string, policy: { datasetId: string; requiredRuns: number }, signal?: AbortSignal): Promise<PromptPolicyDto> {
    return this.request("PUT", `/prompts/${e(promptId)}/policy`, policy, signal);
  }
  async deletePolicy(promptId: string, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `/prompts/${e(promptId)}/policy`, undefined, signal);
  }

  getApprovals(promptId: string, signal?: AbortSignal): Promise<PromptApprovalsResponse> {
    return this.request("GET", `/prompts/${e(promptId)}/approvals`, undefined, signal);
  }
  openApproval(promptId: string, input: OpenApprovalInput, signal?: AbortSignal): Promise<ApprovalRequestDto> {
    return this.request("POST", `/prompts/${e(promptId)}/approvals`, input, signal);
  }
  decideApproval(requestId: string, decision: "approve" | "reject", comment: string, signal?: AbortSignal): Promise<ApprovalRequestDto> {
    return this.request("POST", `/approvals/${e(requestId)}/decision`, { decision, comment }, signal);
  }
  executeApproval(requestId: string, signal?: AbortSignal): Promise<ApprovalRequestDto> {
    return this.request("POST", `/approvals/${e(requestId)}/execute`, undefined, signal);
  }
  cancelApproval(requestId: string, signal?: AbortSignal): Promise<ApprovalRequestDto> {
    return this.request("POST", `/approvals/${e(requestId)}/cancel`, undefined, signal);
  }
  addApprover(requestId: string, approverId: string, signal?: AbortSignal): Promise<ApprovalRequestDto> {
    return this.request("POST", `/approvals/${e(requestId)}/approvers`, { approverId }, signal);
  }
  async approvalInbox(organizationId: string, experimentId: string | null, signal?: AbortSignal): Promise<ApprovalRequestDto[]> {
    const query = experimentId ? `?experimentId=${e(experimentId)}` : "";
    return (await this.request<{ items: ApprovalRequestDto[] }>("GET", `/organizations/${e(organizationId)}/approvals${query}`, undefined, signal)).items;
  }
  getApprovalRules(scope: ApprovalScope, signal?: AbortSignal): Promise<ApprovalRulesResponse> {
    return this.request("GET", `${rulesPath(scope)}`, undefined, signal);
  }
  setApprovalRule(scope: ApprovalScope, rule: Pick<ApprovalRuleDto, "action" | "stage" | "requirements" | "approvers">, signal?: AbortSignal): Promise<ApprovalRuleDto> {
    return this.request("PUT", rulesPath(scope), rule, signal);
  }
  async deleteApprovalRule(scope: ApprovalScope, action: "publish" | "promote", stage: string, signal?: AbortSignal): Promise<void> {
    await this.request("DELETE", `${rulesPath(scope)}?action=${e(action)}&stage=${e(stage)}`, undefined, signal);
  }

  private async request<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        signal,
        headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(0, "Network error", error instanceof Error ? error.message : undefined);
    }
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }
}

const rulesPath = (scope: ApprovalScope): string => `/${scope.type === "organization" ? "organizations" : "experiments"}/${e(scope.id)}/approval-rules`;

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const problem = (await response.json()) as { title?: string; detail?: string; errors?: Record<string, string> };
    return new ApiError(response.status, problem.title ?? response.statusText, problem.detail, problem.errors);
  } catch {
    return new ApiError(response.status, response.statusText || "Error", undefined);
  }
}
