import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import {
  compareWithNoise, evaluatorNoise, unstableItems,
  type EvaluatorComparison, type EvaluatorNoise, type Instability, type UnstableItem,
} from "@/domain/evaluation-noise";
import type { ScoreAggregate } from "@/domain/evaluation";
import type { DatasetRunStatus, DatasetRunWithDataset } from "@/domain/identity";
import type { TenantScope } from "@/domain/tenant";

export interface RunVariability {
  /** null = el run se lanzó con `repeats=1`: no hay repeticiones de las que sacar ruido. */
  group: { id: string; total: number; completed: number } | null;
  executions: Array<{ runId: string; index: number; status: DatasetRunStatus; createdAt: string; aggregates: ScoreAggregate[] }>;
  evaluators: EvaluatorNoise[];
  instability: Instability[];
  unstableItems: UnstableItem[];
}

export interface RunNoiseComparison {
  baseline: { runId: string; executions: number };
  candidate: { runId: string; executions: number };
  evaluators: EvaluatorComparison[];
}

/**
 * Ruido de las evaluaciones (ADR-097): reúne las ejecuciones de un run con repeticiones, mide cuánto varían y compara dos runs
 * contra ese ruido. La estadística está en `domain/evaluation-noise`; aquí solo se leen los datos. Solo cuentan las ejecuciones
 * completadas: una que sigue subiendo items daría un agregado a medias.
 */
export class EvaluationNoiseService {
  constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly scoreRepository: ScoreRepository,
  ) {}

  /** Las ejecuciones del run (todas las de su grupo, por orden) o él solo si no tiene repeticiones. */
  private executionsOf(all: DatasetRunWithDataset[], run: DatasetRunWithDataset): DatasetRunWithDataset[] {
    if (!run.runGroup) return [run];
    const groupId = run.runGroup.id;
    return all.filter((r) => r.runGroup?.id === groupId).sort((a, b) => a.runGroup!.index - b.runGroup!.index);
  }

  private async aggregatesByRun(scope: TenantScope, runIds: string[]): Promise<Map<string, ScoreAggregate[]>> {
    const byRun = new Map<string, ScoreAggregate[]>(runIds.map((id) => [id, []]));
    for (const a of runIds.length ? await this.scoreRepository.aggregateForRuns(scope, runIds) : []) byRun.get(a.datasetRunId)?.push(a);
    return byRun;
  }

  /** null si el run no existe en el experimento. */
  async variability(scope: TenantScope, experimentId: string, runId: string): Promise<RunVariability | null> {
    const all = await this.identityRepository.listRunsForExperiment(experimentId);
    const run = all.find((r) => r.id === runId);
    if (!run) return null;
    const executions = this.executionsOf(all, run);
    const done = executions.filter((e) => e.status === "completed");
    const aggregates = await this.aggregatesByRun(scope, done.map((e) => e.id));

    const evaluators = evaluatorNoise(done.map((e) => aggregates.get(e.id) ?? []));
    let instability: Instability[] = [];
    let items: UnstableItem[] = [];
    if (run.runGroup && done.length >= 2) {
      const results = await Promise.all(done.map((e) => this.scoreRepository.listScoresByRun(scope, e.id)));
      ({ counts: instability, items } = unstableItems(results));
    }
    return {
      group: run.runGroup ? { id: run.runGroup.id, total: run.runGroup.total, completed: done.length } : null,
      executions: executions.map((e, i) => ({
        runId: e.id, index: e.runGroup?.index ?? i + 1, status: e.status, createdAt: e.createdAt, aggregates: aggregates.get(e.id) ?? [],
      })),
      evaluators, instability, unstableItems: items,
    };
  }

  /** null si alguno de los dos runs no existe en el experimento. */
  async compare(scope: TenantScope, experimentId: string, baselineId: string, candidateId: string): Promise<RunNoiseComparison | null> {
    const all = await this.identityRepository.listRunsForExperiment(experimentId);
    const a = all.find((r) => r.id === baselineId);
    const b = all.find((r) => r.id === candidateId);
    if (!a || !b) return null;
    const sides = [a, b].map((run) => this.executionsOf(all, run).filter((e) => e.status === "completed"));
    const aggregates = await this.aggregatesByRun(scope, [...new Set(sides.flat().map((e) => e.id))]);
    const side = (run: DatasetRunWithDataset, executions: DatasetRunWithDataset[]) => ({
      datasetId: run.datasetId, versionMajor: run.versionMajor, versionMinor: run.versionMinor,
      executions: executions.map((e) => aggregates.get(e.id) ?? []),
    });
    return {
      baseline: { runId: a.id, executions: sides[0]!.length },
      candidate: { runId: b.id, executions: sides[1]!.length },
      evaluators: compareWithNoise(side(a, sides[0]!), side(b, sides[1]!)),
    };
  }
}
