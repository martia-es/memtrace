import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toDatasetRunDetailResponse, toScoreAggregateDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getScores } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Detalle de una ejecución: metadatos + items con sus scores (dashboard, sesión únicamente). */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; datasetId: string; runId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId, runId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const experiment = await identityRepository.getExperiment(experimentId);
    const dataset = await identityRepository.getDataset(datasetId);
    const run = await identityRepository.getDatasetRun(runId);
    if (!experiment || !dataset || dataset.experimentId !== experimentId || !run || run.datasetId !== datasetId) {
      return problem(404, "Not Found", "Dataset run not found");
    }

    const [items, aggregates] = await Promise.all([
      getScores().listScoresByRun(experiment.serviceName, runId),
      getScores().aggregateForRuns(experiment.serviceName, [runId]),
    ]);
    return json(toDatasetRunDetailResponse(dataset, run, items, aggregates.map(toScoreAggregateDto)));
  });
}
