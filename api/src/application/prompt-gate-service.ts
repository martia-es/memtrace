import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { PromptEvidenceRepository } from "@/application/ports/prompt-evidence-repository";
import type { PromptRepository } from "@/application/ports/prompt-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { Prompt } from "@/domain/prompt";
import { evaluatePromptGate, gatedEnvironments, validateRequiredRuns, type PromptGateResult, type PromptPolicy } from "@/domain/prompt-gate";
import { PromptInvariantError, PromptNotFoundError, ValidationError } from "@/domain/errors";

/** Lo que `PromptService` necesita del gate al mover un tag. */
export interface PromptGatePort {
  check(prompt: Prompt, tag: string, version: number): Promise<PromptGateResult>;
}

/**
 * Gate de promoción de prompts (ADR-070). Reúne la política, los runs de evaluación que evaluaron exactamente esa versión
 * (item → traza → marca de prompt, ADR-068/069), sus agregados y los objetivos de las score configs, y deja la decisión a
 * `evaluatePromptGate`. Solo lee; además administra la política de cada prompt.
 */
export class PromptGateService implements PromptGatePort {
  constructor(
    private readonly prompts: PromptRepository,
    private readonly identity: IdentityRepository,
    private readonly scores: ScoreRepository,
    private readonly scoreConfigs: ScoreConfigRepository,
    private readonly evidence: PromptEvidenceRepository,
  ) {}

  async check(prompt: Prompt, tag: string, version: number): Promise<PromptGateResult> {
    const [keys, policy] = await Promise.all([this.prompts.environmentKeys(prompt.organizationId), this.prompts.getPolicy(prompt.id)]);
    const gated = gatedEnvironments(keys);
    const base = { tag, version, gated, policy, previouslyServed: false, runs: [] };

    // no hace falta mirar nada más si el gate no aplica o no hay política
    if (!gated.includes(tag) || !policy) return evaluatePromptGate(base);
    const previouslyServed = await this.prompts.wasServed(prompt.id, tag, version);
    if (previouslyServed || policy.datasetId === null) return evaluatePromptGate({ ...base, previouslyServed });

    const dataset = await this.identity.getDataset(policy.datasetId);
    const experiment = dataset ? await this.identity.getExperiment(dataset.experimentId) : null;
    if (!dataset || !experiment) return evaluatePromptGate({ ...base, policy: { ...policy, datasetId: null } });

    const datasetRuns = (await this.identity.listRunsForExperiment(experiment.id)).filter((r) => r.datasetId === dataset.id);
    const onVersion = new Set(await this.evidence.runsUsingVersion({ scope: { experimentId: experiment.id, serviceName: experiment.serviceName }, promptName: prompt.name, version, runIds: datasetRuns.map((r) => r.id) }));
    const runs = datasetRuns.filter((r) => onVersion.has(r.id));

    const [aggregates, configs] = await Promise.all([
      runs.length ? this.scores.aggregateForRuns({ experimentId: experiment.id, serviceName: experiment.serviceName }, runs.map((r) => r.id)) : Promise.resolve([]),
      this.scoreConfigs.list(experiment.id, false),
    ]);
    const targets = new Map(configs.filter((c) => c.targetPassRate !== null).map((c) => [c.name, c.targetPassRate as number]));

    return evaluatePromptGate({
      ...base,
      targets,
      runs: runs.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        revision: r.revision,
        revisionDirty: r.revisionDirty,
        createdAt: r.createdAt,
        itemCount: r.itemCount,
        aggregates: aggregates.filter((a) => a.datasetRunId === r.id).map((a) => ({ name: a.name, dataType: a.dataType, passRate: a.passRate, count: a.count })),
      })),
    });
  }

  getPolicy(promptId: string): Promise<PromptPolicy | null> {
    return this.prompts.getPolicy(promptId);
  }

  /** Crea o cambia la política. El dataset tiene que ser de uno de los agentes del prompt: no se evalúa contra datos ajenos. */
  async setPolicy(prompt: Prompt, userId: string, input: { datasetId: string; requiredRuns: number }): Promise<PromptPolicy> {
    const requiredRuns = validateRequiredRuns(input.requiredRuns);
    const dataset = await this.identity.getDataset(input.datasetId);
    if (!dataset) throw new PromptNotFoundError("Dataset");
    if (!prompt.experimentIds.includes(dataset.experimentId)) throw new PromptInvariantError("The dataset has to belong to one of this prompt's agents");
    if (prompt.archivedAt) throw new PromptInvariantError("The prompt is archived; restore it before changing its policy");
    return this.prompts.setPolicy(prompt.id, { datasetId: dataset.id, requiredRuns }, userId);
  }

  async deletePolicy(prompt: Prompt): Promise<void> {
    if (prompt.archivedAt) throw new ValidationError("The prompt is archived", { prompt: "Restore it before changing its policy" });
    await this.prompts.deletePolicy(prompt.id);
  }
}
