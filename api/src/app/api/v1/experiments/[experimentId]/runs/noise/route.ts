import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import type { RunNoiseComparisonResponse } from "@/adapters/inbound/http/contract";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getEvaluationNoise, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Compara dos runs contra el ruido medido (ADR-097): por evaluador, la diferencia y si queda «por encima del ruido», «dentro del
 * ruido» o «sin medir». `baseline` y `candidate` son ids de run; si pertenecen a un run con repeticiones se usa todo su grupo.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) return problem(403, "Forbidden", "No access to this experiment");
    const experiment = await identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const params = new URL(request.url).searchParams;
    const baseline = params.get("baseline");
    const candidate = params.get("candidate");
    if (!baseline || !candidate) return problem(400, "Bad Request", "baseline and candidate run ids are required");

    const result = await getEvaluationNoise().compare({ experimentId: experiment.id, serviceName: experiment.serviceName }, experimentId, baseline, candidate);
    if (!result) return problem(404, "Not Found", "Run not found");
    return json(result satisfies RunNoiseComparisonResponse);
  });
}
