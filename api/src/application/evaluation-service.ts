import { randomUUID } from "node:crypto";
import type { IdentityRepository } from "@/application/ports/identity-repository";
import type { ScoreRepository } from "@/application/ports/score-repository";
import type { DatasetRunItemSubmission } from "@/domain/evaluation";
import type { DatasetRun } from "@/domain/identity";

/**
 * Único caso de uso que toca los dos almacenes de evaluación (ADR-028): inserta los scores en
 * ClickHouse primero (con un id generado aquí), y solo si tiene éxito crea el registro de
 * metadatos en PostgreSQL con ese mismo id — así un fallo de ClickHouse nunca deja un
 * `dataset_run` huérfano (visible en el listado pero sin datos detrás).
 *
 * El SDK (`memtrace.eval`) solo conoce un `dataset_id` plano, sin versión (ADR-031): aquí se
 * resuelve la última versión del dataset en el momento del envío y el run queda fijado a ella,
 * sin que el SDK tenga que cambiar.
 */
export class EvaluationService {
  constructor(
    private readonly identityRepository: IdentityRepository,
    private readonly scoreRepository: ScoreRepository,
  ) {}

  async submitDatasetRun(serviceName: string, datasetId: string, name: string, items: DatasetRunItemSubmission[]): Promise<DatasetRun> {
    const latestVersion = await this.identityRepository.getLatestDatasetVersion(datasetId);
    if (!latestVersion) throw new Error(`dataset ${datasetId} has no versions`);
    const runId = randomUUID();
    await this.scoreRepository.insertScores(serviceName, runId, items);
    return this.identityRepository.createDatasetRun(runId, datasetId, latestVersion.id, name, items.length);
  }
}
