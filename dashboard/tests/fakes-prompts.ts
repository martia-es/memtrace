/** Dobles del registro de prompts (ADR-067). */
import type { PromptDetailDto, PromptEvidenceResponse, PromptSummaryDto, PromptTagEventDto, PromptVersionDto, VersionEvidenceDto } from "@contract";
import type { NewPromptInput, PromptApi } from "@/application/prompt-api";

export function promptVersion(version: number, content: string, extra: Partial<PromptVersionDto> = {}): PromptVersionDto {
  return { version, content, variables: [], contentHash: `h${version}`, parentVersion: version > 1 ? version - 1 : null, message: "", createdBy: "u1", createdAt: "2026-10-08T10:00:00.000Z", ...extra };
}

export function promptDetail(overrides: Partial<PromptDetailDto> = {}): PromptDetailDto {
  return {
    prompt: { id: "p1", organizationId: "org-1", name: "weather-system", description: "System prompt of the weather assistant", archivedAt: null, createdBy: "u1", createdAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-08T10:00:00.000Z", experimentIds: ["exp-1"] },
    versions: [promptVersion(2, "Eres breve.\nResponde en español.", { message: "shorter" }), promptVersion(1, "Eres un asistente del tiempo para {{ciudad}}.\nResponde en español.", { variables: ["ciudad"], message: "first draft" })],
    tags: [{ tag: "dev", version: 2, updatedBy: "u1", updatedAt: "2026-10-08T10:05:00.000Z" }],
    events: [{ id: "e1", tag: "dev", fromVersion: null, toVersion: 2, changedBy: "u1", reason: "ready to test", createdAt: "2026-10-08T10:05:00.000Z" }],
    usage: [],
    environmentKeys: ["dev", "pre", "pro"],
    ...overrides,
  };
}

export function versionEvidence(version: number, extra: Partial<VersionEvidenceDto> = {}): VersionEvidenceDto {
  return {
    version, traces: 120, conversations: 60, errorTraces: 12, errorRate: 0.1, latencyMs: { p50: 800, p95: 2400 }, inputTokens: 120_000, outputTokens: 12_000,
    costUsd: 1.2, costPerTraceUsd: 0.01, costComplete: true, feedback: { up: 8, down: 2, ratedTraces: 10, satisfaction: 80 }, evaluators: [], errorCauses: [],
    firstSeen: "2026-10-08T08:00:00.000Z", lastSeen: "2026-10-08T10:00:00.000Z", ...extra,
  };
}

export function promptSummary(name: string, extra: Partial<PromptSummaryDto> = {}): PromptSummaryDto {
  return { ...promptDetail().prompt, id: `id-${name}`, name, description: "", latestVersion: 1, tags: {}, ...extra };
}

/** Puerto de prompts en memoria: guarda las llamadas para que las pruebas las comprueben. */
export class FakePromptApi implements PromptApi {
  calls: Array<{ method: string; args: unknown[] }> = [];
  list: PromptSummaryDto[] = [];
  detail: PromptDetailDto = promptDetail();
  evidence: PromptEvidenceResponse = { range: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-08T00:00:00.000Z" }, versions: [] };

  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }
  async listForAgent(experimentId: string, includeArchived: boolean) {
    this.record("listForAgent", experimentId, includeArchived);
    return this.list;
  }
  async create(experimentId: string, input: NewPromptInput) {
    this.record("create", experimentId, input);
    return this.detail;
  }
  async get(promptId: string) {
    this.record("get", promptId);
    return this.detail;
  }
  async update(promptId: string, patch: { description?: string; archived?: boolean; experimentIds?: string[] }) {
    this.record("update", promptId, patch);
    return this.detail;
  }
  async saveVersion(promptId: string, input: { content: string; message: string; parentVersion?: number | null }) {
    this.record("saveVersion", promptId, input);
    return promptVersion(3, input.content, { message: input.message, parentVersion: input.parentVersion ?? null });
  }
  async getEvidence(experimentId: string, promptId: string, range: { from: Date; to: Date }) {
    this.record("getEvidence", experimentId, promptId, range);
    return this.evidence;
  }
  async moveTag(promptId: string, tag: string, version: number | null, reason: string): Promise<PromptTagEventDto> {
    this.record("moveTag", promptId, tag, version, reason);
    return { id: "e2", tag, fromVersion: null, toVersion: version, changedBy: "u1", reason, createdAt: "2026-10-08T11:00:00.000Z" };
  }
}
