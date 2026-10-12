import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toScoreAggregateDto } from "@/adapters/inbound/http/mappers";
import type { RunVariabilityResponse } from "@/adapters/inbound/http/contract";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getEvaluationNoise, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Variabilidad de un run (ADR-097): qué valió cada evaluador en cada ejecución de un run lanzado con `repeats=N`, cuánto varía y qué
 * items cambian de resultado entre ejecuciones. Un run sin repeticiones responde con `group: null` y sin ruido. Dashboard, sesión únicamente.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; runId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, runId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) return problem(403, "Forbidden", "No access to this experiment");
    const experiment = await identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const result = await getEvaluationNoise().variability({ experimentId: experiment.id, serviceName: experiment.serviceName }, experimentId, runId);
    if (!result) return problem(404, "Not Found", "Run not found");
    return json({
      group: result.group,
      executions: result.executions.map((e) => ({ runId: e.runId, index: e.index, status: e.status, createdAt: e.createdAt, aggregates: e.aggregates.map(toScoreAggregateDto) })),
      evaluators: result.evaluators.map(({ judgeKey: _judgeKey, ...e }) => e),
      instability: result.instability,
      unstableItems: result.unstableItems,
    } satisfies RunVariabilityResponse);
  });
}
