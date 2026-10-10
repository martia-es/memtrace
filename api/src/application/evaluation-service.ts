import type { TenantScope } from "@/domain/tenant";
import { randomUUID } from "node:crypto";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { DatasetRunItemSubmission } from "@/domain/evaluation";
import { parseDatasetVersionSpec } from "@/domain/dataset-version";
import { ValidationError } from "@/domain/errors";
import type { DatasetRun, RunRevision } from "@/domain/identity";

/** El run existe pero ya no admite más items (ya está `completed`). */
export class DatasetRunClosedError extends Error {
  constructor(runId: string) {
    super(`dataset run ${runId} is already completed`);
    this.name = "DatasetRunClosedError";
  }
}

/**
 * Único caso de uso que toca los dos almacenes de evaluación (ADR-028): inserta los scores en
 * ClickHouse y registra los metadatos del run en PostgreSQL. No hay transacción distribuida
 * entre ambos; el orden importa: ClickHouse primero, PostgreSQL después, con el mismo `runId`.
 * Si ClickHouse falla, no se crea ningún `dataset_run` y el SDK ve el error. Si PostgreSQL falla
 * tras escribir en ClickHouse, quedan scores huérfanos que ninguna vista muestra (ya que
 * todas las lecturas parten de un `dataset_run`) — inocuo, y preferible al caso contrario (un
 * run visible en el dashboard sin scores).
 *
 * Un run se sube por lotes (ADR-034): `submitDatasetRun` lo crea (con el primer lote, o vacío) y
 * `appendToDatasetRun` añade el resto; el run queda `running` hasta que un lote llega con `complete`.
 */
export class EvaluationService {
  constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly scoreRepository: ScoreRepository,
  ) {}

  /** `datasetVersion` ("major.minor") es obligatoria: un run siempre declara de qué versión salieron sus items (ADR-034). */
  async submitDatasetRun(
    scope: TenantScope,
    datasetId: string,
    name: string,
    items: DatasetRunItemSubmission[],
    datasetVersion: string,
    complete = true,
    revision: RunRevision | null = null,
  ): Promise<DatasetRun> {
    const { major, minor } = parseDatasetVersionSpec(datasetVersion, "datasetVersion");
    const version = (await this.identityRepository.listDatasetVersions(datasetId)).find((v) => v.major === major && v.minor === minor);
    if (!version) throw new ValidationError(`dataset ${datasetId} has no version ${datasetVersion}`, { datasetVersion: "unknown version" });
    const runId = randomUUID();
    await this.scoreRepository.insertScores(scope, runId, items, 0);
    const run = await this.identityRepository.createDatasetRun(runId, datasetId, version.id, name, items.length, complete ? "completed" : "running", revision);
    if (complete) await this.summarize(scope, runId);
    return run;
  }

  /** Congela el agregado de un run recién completado (ADR-045). Si falla no se pierde nada: las lecturas lo recalculan al vuelo. */
  private async summarize(scope: TenantScope, runId: string): Promise<void> {
    try {
      await this.scoreRepository.materializeRunSummary(scope, runId);
    } catch (error) {
      console.error(`[memtrace-api] could not store the summary of run ${runId}; it will be computed on read:`, error);
    }
  }

  /** Añade un lote a un run abierto. Los índices (`itemIndex` o `startIndex`) hacen idempotente el reenvío; los items pueden llegar en cualquier orden. Devuelve null si el run no existe. */
  async appendToDatasetRun(
    scope: TenantScope,
    datasetId: string,
    runId: string,
    startIndex: number,
    items: DatasetRunItemSubmission[],
    complete: boolean,
  ): Promise<DatasetRun | null> {
    const run = await this.identityRepository.getDatasetRun(runId);
    if (!run || run.datasetId !== datasetId) return null;
    if (run.status === "completed") throw new DatasetRunClosedError(runId);
    await this.scoreRepository.insertScores(scope, runId, items, startIndex);
    const total = items.length === 0 ? startIndex : Math.max(...items.map((item, i) => item.itemIndex ?? startIndex + i)) + 1;
    const updated = await this.identityRepository.updateDatasetRunProgress(runId, total, complete);
    if (complete) await this.summarize(scope, runId);
    return updated;
  }
}
