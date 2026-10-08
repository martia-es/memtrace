import type { PromptDetail } from "@/application/prompt-service";
import type { Prompt, PromptSummary, PromptTag, PromptTagEvent, PromptVersion } from "@/domain/prompt";
import type { PromptDetailDto, PromptDto, PromptSummaryDto, PromptTagDto, PromptTagEventDto, PromptVersionDto } from "./contract";

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
});

export const toPromptDetailDto = (d: PromptDetail): PromptDetailDto => ({
  prompt: toPromptDto(d.prompt),
  versions: d.versions.map(toPromptVersionDto),
  tags: d.tags.map(toPromptTagDto),
  events: d.events.map(toPromptTagEventDto),
  environmentKeys: d.environmentKeys,
});
