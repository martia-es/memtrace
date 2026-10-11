import type { AssistantRegistryService } from "@/application/assistant-registry-service";
import type { DeployGateService } from "@/application/deploy-gate-service";
import type { CiDispatcher } from "@/application/ports/ci-dispatcher";
import { checkFromGate } from "@/domain/pr-gate";

export interface PrGateRun {
  id: string;
  datasetId: string;
  revision: string | null;
  revisionDirty: boolean | null;
}

/**
 * Gate de evaluación en el PR (ADR-064, fase 3). Cada vez que un run de evaluación cambia (se abre, recibe resultados, se
 * cierra), publica en GitHub el estado del commit evaluado como check run. Un PR no se puede fusionar si la regla de rama exige
 * ese check y el commit no pasa. Es un efecto secundario del run: si falla, el run no se ve afectado.
 */
export class PrGateService {
  constructor(
    private readonly registry: Pick<AssistantRegistryService, "getCard">,
    private readonly gate: Pick<DeployGateService, "check">,
    private readonly dispatcher: Pick<CiDispatcher, "publishCheck">,
    /** URL pública del dashboard, para el enlace «Details» del check */
    private readonly appUrl: string,
  ) {}

  /** Nunca lanza: devuelve si publicó algo. */
  async onRunChanged(experimentId: string, run: PrGateRun): Promise<boolean> {
    try {
      if (!run.revision || run.revisionDirty) return false; // sin commit, o con cambios sin commitear: no representa a ningún commit
      const { repo } = await this.registry.getCard(experimentId);
      if (!repo?.prGate || repo.provider !== "github") return false;
      const result = await this.gate.check(experimentId, run.revision);
      const check = checkFromGate(result, `${this.appUrl.replace(/\/+$/, "")}/experiments/${experimentId}/datasets/${run.datasetId}/runs/${run.id}`);
      if (!check) return false;
      await this.dispatcher.publishCheck(repo, check);
      return true;
    } catch (error) {
      console.error(`[memtrace-api] could not publish the PR check for run ${run.id}:`, error instanceof Error ? error.message : error);
      return false;
    }
  }
}
