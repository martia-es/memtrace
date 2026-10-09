import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import type { IncludeStatus, PromptService, UsedBy } from "@/application/prompt-service";
import type { Prompt } from "@/domain/prompt";
import { promotionImpact, servingByAgent, type AgentLink, type PromotionImpact } from "@/domain/prompt-map";

export interface PromptMap {
  prompt: Prompt;
  /** agentes enlazados y lo que cada uno sirve hoy, por entorno */
  agents: AgentLink[];
  /** dataset de la política de promoción (ADR-070), si tiene */
  dataset: { id: string; name: string; experimentId: string; requiredRuns: number } | null;
  /** fragmentos que incluye (ADR-073) */
  includes: IncludeStatus[];
  /** si es un fragmento: prompts que lo incluyen */
  usedBy: UsedBy[];
  /** qué cambia si `tag` pasa a `version`; solo cuando se pregunta por ello */
  impact: PromotionImpact | null;
}

/**
 * Mapa de dependencias de un prompt (ADR-074): de qué agentes se lee, con qué dataset se evalúa antes de promover, qué fragmentos
 * incluye y quién lo incluye a él; y, antes de mover un tag, a quién llegaría el cambio. Solo lee.
 */
export class PromptMapService {
  constructor(
    private readonly prompts: PromptService,
    private readonly repo: PromptRepository,
    private readonly identity: IdentityRepository,
  ) {}

  async map(promptId: string, move?: { tag: string; version: number }): Promise<PromptMap> {
    const prompt = await this.prompts.get(promptId);
    const [usage, policy, links] = await Promise.all([this.repo.listUsage(promptId), this.repo.getPolicy(promptId), this.prompts.fragmentLinks(prompt)]);
    const experiments = await Promise.all(prompt.experimentIds.map((id) => this.identity.getExperiment(id)));
    const agents = servingByAgent(experiments.flatMap((e) => (e ? [{ experimentId: e.id, name: e.name }] : [])), usage);
    const dataset = policy?.datasetId ? await this.identity.getDataset(policy.datasetId) : null;
    return {
      prompt,
      agents,
      dataset: dataset && policy ? { id: dataset.id, name: dataset.name, experimentId: dataset.experimentId, requiredRuns: policy.requiredRuns } : null,
      ...links,
      impact: move ? await this.impact(prompt, agents, move) : null,
    };
  }

  private async impact(prompt: Prompt, agents: AgentLink[], move: { tag: string; version: number }): Promise<PromotionImpact> {
    const [current, dependents] = await Promise.all([
      this.repo.getVersionByTag(prompt.id, move.tag),
      prompt.kind === "fragment" ? this.repo.usedBy(prompt.organizationId, prompt.name) : Promise.resolve([]),
    ]);
    return promotionImpact({
      tag: move.tag,
      toVersion: move.version,
      agents,
      currentVersion: current?.version ?? null,
      dependents: dependents.map((d) => ({ promptId: d.promptId, name: d.name, refs: d.includes.filter((i) => i.name === prompt.name).map((i) => i.ref) })),
    });
  }
}
