import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Borra un gráfico custom guardado (ADR-027). Requiere solo acceso de lectura al experimento (igual que crearlo). */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; metricId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, metricId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    await identityRepository.deleteCustomMetric(experimentId, metricId);
    return json({ status: "ok" });
  });
}
