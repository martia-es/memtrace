import { requireExperimentAccess, requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { groupAggregatesByRun, toDatasetRunSummaryDto, toDatasetRunsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { submitDatasetRunBody } from "@/adapters/inbound/http/schemas";
import { getEvaluation, getIdentity, getScores } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista las ejecuciones de un dataset, cada una con sus métricas agregadas (dashboard, sesión únicamente). */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const experiment = await identityRepository.getExperiment(experimentId);
    const dataset = await identityRepository.getDataset(datasetId);
    if (!experiment || !dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const runs = await identityRepository.listDatasetRuns(datasetId);
    const aggregatesByRun = groupAggregatesByRun(await getScores().aggregateForRuns(experiment.serviceName, runs.map((r) => r.id)));
    return json(toDatasetRunsListResponse(runs, aggregatesByRun));
  });
}

/**
 * Sube el resultado de una ejecución (`memtrace.eval.MemTraceResultsSink.save()`, ADR-028):
 * inserta los scores en ClickHouse y crea el registro de metadatos en PostgreSQL.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; datasetId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, datasetId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;

    const { identityRepository } = getIdentity();
    const dataset = await identityRepository.getDataset(datasetId);
    if (!dataset || dataset.experimentId !== experimentId) return problem(404, "Not Found", "Dataset not found");

    const { name, items } = await parseJsonOrThrow(submitDatasetRunBody, request);
    const run = await getEvaluation().submitDatasetRun(
      access.serviceName,
      datasetId,
      name,
      items.map((i) => ({
        input: i.input,
        expectedOutput: i.expectedOutput ?? null,
        output: i.output ?? null,
        traceId: i.traceId ?? null,
        error: i.error ?? null,
        scores: i.scores,
      })),
    );
    return json(toDatasetRunSummaryDto(run), 201);
  });
}
