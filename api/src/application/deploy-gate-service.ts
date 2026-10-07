import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreConfigRepository } from "@/application/ports/score-config-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import { evaluateDeployGate, sameRevision, validateSha, type GateResult } from "@/domain/deploy-gate";
import { AssistantNotFoundError } from "@/domain/errors";

/**
 * ¿Puede desplegarse este commit? (ADR-064). Reúne los runs de evaluación del experimento, sus agregados y los objetivos
 * de pass rate de sus score configs, y deja la decisión a `evaluateDeployGate`. Solo lee.
 */
export class DeployGateService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly scores: ScoreRepository,
    private readonly scoreConfigs: ScoreConfigRepository,
    /** commits ya desplegados con éxito (rollback). El historial de despliegues llega con el botón Deploy; hasta entonces ninguno. */
    private readonly deployedShas: (experimentId: string) => Promise<string[]> = async () => [],
  ) {}

  async check(experimentId: string, rawSha: string): Promise<GateResult> {
    const sha = validateSha(rawSha);
    const experiment = await this.identity.getExperiment(experimentId);
    if (!experiment) throw new AssistantNotFoundError("Agent");

    const [allRuns, configs, deployed] = await Promise.all([
      this.identity.listRunsForExperiment(experimentId),
      this.scoreConfigs.list(experimentId, false),
      this.deployedShas(experimentId),
    ]);
    const runs = allRuns.filter((r) => sameRevision(r.revision, sha));
    const aggregates = runs.length ? await this.scores.aggregateForRuns(experiment.serviceName, runs.map((r) => r.id)) : [];
    const targets = new Map(configs.filter((c) => c.targetPassRate !== null).map((c) => [c.name, c.targetPassRate as number]));

    return evaluateDeployGate({
      sha,
      targets,
      previouslyDeployed: deployed.some((d) => sameRevision(d, sha)),
      runs: runs.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        revision: r.revision,
        revisionDirty: r.revisionDirty,
        createdAt: r.createdAt,
        aggregates: aggregates.filter((a) => a.datasetRunId === r.id).map((a) => ({ name: a.name, dataType: a.dataType, passRate: a.passRate })),
      })),
    });
  }
}
