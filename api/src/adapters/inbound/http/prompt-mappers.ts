import type { PromptDetail } from "@/application/prompt-service";
import { USAGE_FRESH_MS, type Prompt, type PromptSummary, type PromptTag, type PromptTagEvent, type PromptUsage, type PromptVersion } from "@/domain/prompt";
import type { PromptEvidence } from "@/domain/prompt-evidence";
import type { PromptGateResult, PromptPolicy } from "@/domain/prompt-gate";
import type { PromptDetailDto, PromptDto, PromptEvidenceResponse, PromptGateDto, PromptPolicyDto, PromptResolveDto, PromptSummaryDto, PromptTagDto, PromptTagEventDto, PromptUsageDto, PromptVersionDto } from "./contract";

/** Dominio -> contrato HTTP del registro de prompts (ADR-067). Los DTO viven en contract.ts porque los comparte el dashboard. */

export const toPromptDto = (p: Prompt): PromptDto => ({
  id: p.id,
  organizationId: p.organizationId,
  name: p.name,
  description: p.description,
  archivedAt: p.archivedAt,
  createdBy: p.createdBy,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  experimentIds: p.experimentIds,
});

export const toPromptSummaryDto = (p: PromptSummary): PromptSummaryDto => ({ ...toPromptDto(p), latestVersion: p.latestVersion, tags: p.tags });

export const toPromptVersionDto = (v: PromptVersion): PromptVersionDto => ({
  version: v.version,
  content: v.content,
  variables: v.variables,
  contentHash: v.contentHash,
  parentVersion: v.parentVersion,
  message: v.message,
  createdBy: v.createdBy,
  createdAt: v.createdAt,
});

export const toPromptTagDto = (t: PromptTag): PromptTagDto => ({ tag: t.tag, version: t.version, updatedBy: t.updatedBy, updatedAt: t.updatedAt });

export const toPromptTagEventDto = (e: PromptTagEvent): PromptTagEventDto => ({
  id: e.id,
  tag: e.tag,
  fromVersion: e.fromVersion,
  toVersion: e.toVersion,
  changedBy: e.changedBy,
  reason: e.reason,
  createdAt: e.createdAt,
  gateVerdict: e.gateVerdict,
  gateBypassed: e.gateBypassed,
  bypassReason: e.bypassReason,
});

export const toPromptPolicyDto = (p: PromptPolicy): PromptPolicyDto => ({ datasetId: p.datasetId, requiredRuns: p.requiredRuns, updatedBy: p.updatedBy, updatedAt: p.updatedAt });

export const toPromptGateDto = (g: PromptGateResult): PromptGateDto => ({
  allowed: g.allowed,
  verdict: g.verdict,
  tag: g.tag,
  version: g.version,
  requiredRuns: g.requiredRuns,
  reason: g.reason,
  runs: g.runs,
});

export const toPromptUsageDto = (u: PromptUsage, nowMs: number): PromptUsageDto => ({
  experimentId: u.experimentId,
  environment: u.environment,
  tag: u.tag,
  version: u.version,
  lastSeenAt: u.lastSeenAt,
  active: nowMs - Date.parse(u.lastSeenAt) < USAGE_FRESH_MS,
});

export const toPromptResolveDto = (prompt: Prompt, version: PromptVersion, tag: string | null): PromptResolveDto => ({
  name: prompt.name,
  version: version.version,
  tag,
  content: version.content,
  variables: version.variables,
  contentHash: version.contentHash,
  archived: prompt.archivedAt !== null,
});

/** ETag de una versión servida al SDK: cambia con la versión y con el texto. */
export const promptEtag = (version: PromptVersion): string => `"v${version.version}-${version.contentHash.slice(0, 16)}"`;

export const toPromptDetailDto = (d: PromptDetail, nowMs: number = Date.now()): PromptDetailDto => ({
  prompt: toPromptDto(d.prompt),
  versions: d.versions.map(toPromptVersionDto),
  tags: d.tags.map(toPromptTagDto),
  events: d.events.map(toPromptTagEventDto),
  usage: d.usage.map((u) => toPromptUsageDto(u, nowMs)),
  environmentKeys: d.environmentKeys,
  gatedEnvironments: d.gatedEnvironments,
  policy: d.policy ? toPromptPolicyDto(d.policy) : null,
});

export const toPromptEvidenceResponse = (e: PromptEvidence): PromptEvidenceResponse => ({
  range: { from: new Date(e.range.fromMs).toISOString(), to: new Date(e.range.toMs).toISOString() },
  versions: e.versions.map((v) => ({
    version: v.version,
    traces: v.traces,
    conversations: v.conversations,
    errorTraces: v.errorTraces,
    errorRate: v.errorRate,
    latencyMs: v.latencyMs,
    inputTokens: v.inputTokens,
    outputTokens: v.outputTokens,
    costUsd: v.costUsd,
    costPerTraceUsd: v.costPerTraceUsd,
    costComplete: v.costComplete,
    feedback: v.feedback,
    evaluators: v.evaluators,
    errorCauses: v.errorCauses,
    firstSeen: new Date(v.firstSeenMs).toISOString(),
    lastSeen: new Date(v.lastSeenMs).toISOString(),
  })),
});
