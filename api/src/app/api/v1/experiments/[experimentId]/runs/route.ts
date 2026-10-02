import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { groupAggregatesByRun, toRunsListResponse } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity, getScores } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Vista global de runs del experimento (ADR-031): todas las ejecuciones de todos los datasets,
 * para navegar runs sin tener que elegir un dataset primero (dashboard, sesión únicamente).
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const experiment = await identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const runs = await identityRepository.listRunsForExperiment(experimentId);
    const aggregatesByRun = groupAggregatesByRun(await getScores().aggregateForRuns(experiment.serviceName, runs.map((r) => r.id)));
    return json(toRunsListResponse(runs, aggregatesByRun));
  });
}
