import type { ApprovalView } from "@/application/approval-service";
import type { PromptDetail } from "@/application/prompt-service";
import type { PromptFailures } from "@/application/prompt-failure-service";
import type { ApprovalRule } from "@/domain/approval";
import { USAGE_FRESH_MS, type Prompt, type PromptSummary, type PromptTag, type PromptTagEvent, type PromptUsage, type PromptVersion } from "@/domain/prompt";
import type { PromptEvidence } from "@/domain/prompt-evidence";
import type { PromptGateResult, PromptPolicy } from "@/domain/prompt-gate";
import type { ApprovalRequestDto, ApprovalRuleDto, ApprovalRulesResponse, PromptDetailDto, PromptDto, PromptEvidenceResponse, PromptFailuresResponse, PromptGateDto, PromptPolicyDto, PromptResolveDto, PromptSummaryDto, PromptTagDto, PromptTagEventDto, PromptUsageDto, PromptVersionDto } from "./contract";

/** Dominio -> contrato HTTP del registro de prompts (ADR-067). Los DTO viven en contract.ts porque los comparte el dashboard. */

export const toPromptDto = (p: Prompt): PromptDto => ({
  id: p.id,
  organizationId: p.organizationId,
  kind: p.kind,
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
  source: v.source,
  includes: v.includes,
  status: v.status,
  origin: v.origin,
  publishedAt: v.publishedAt,
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

export const toPromptResolveDto = (prompt: Prompt, version: PromptVersion, tag: string | null, playground = false): PromptResolveDto => ({
  name: prompt.name,
  version: version.version,
  tag,
  content: version.content,
  variables: version.variables,
  contentHash: version.contentHash,
  archived: prompt.archivedAt !== null,
  playground,
  draft: version.status === "draft",
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
  includes: d.includes,
  usedBy: d.usedBy,
  people: d.people,
  approvals: d.approvals,
});

export const toPromptFailuresResponse = (f: PromptFailures): PromptFailuresResponse => ({
  items: f.items.map((i) => ({ traceId: i.traceId, startTime: new Date(i.startTimeUs / 1000).toISOString(), input: i.input, output: i.output, error: i.error, prompts: i.prompts, reasons: i.reasons })),
  scanned: f.scanned,
  counts: f.counts,
});

export const toPromptEvidenceResponse =(e: PromptEvidence): PromptEvidenceResponse => ({
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

export const toApprovalRuleDto = (r: ApprovalRule): ApprovalRuleDto => ({ action: r.action, stage: r.stage, requirements: r.requirements, approvers: r.approvers });

export const toApprovalRequestDto = (v: ApprovalView): ApprovalRequestDto => ({
  id: v.request.id,
  promptId: v.request.promptId,
  promptName: v.promptName,
  action: v.request.action,
  version: v.request.version,
  tag: v.request.tag,
  note: v.request.note,
  bypassReason: v.request.bypassReason,
  requestedBy: v.request.requestedBy,
  status: v.request.status,
  executionError: v.request.executionError,
  createdAt: v.request.createdAt,
  expiresAt: v.request.expiresAt,
  decidedAt: v.request.decidedAt,
  executedAt: v.request.executedAt,
  extraApprovers: v.request.extraApprovers,
  decisions: v.request.decisions,
  rule: v.rule ? toApprovalRuleDto(v.rule) : null,
  evaluation: v.evaluation,
  people: v.people,
});

export const toApprovalRulesResponse = (r: {
  rules: ApprovalRule[];
  organizationRules?: ApprovalRule[];
  options: ApprovalRulesResponse["options"];
}): ApprovalRulesResponse => ({
  rules: r.rules.map(toApprovalRuleDto),
  ...(r.organizationRules ? { organizationRules: r.organizationRules.map(toApprovalRuleDto) } : {}),
  options: r.options,
});
