import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toCustomMetricsListResponse, toSavedCustomMetricDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { saveCustomMetricBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista los gráficos custom guardados del experimento (ADR-027). Requiere solo acceso de lectura. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    return json(toCustomMetricsListResponse(await identityRepository.listCustomMetrics(experimentId)));
  });
}

/** Guarda un gráfico custom (nombre + definición declarativa) para que reaparezca entre visitas. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const { name, definition } = await parseJsonOrThrow(saveCustomMetricBody, request);
    const metric = await identityRepository.createCustomMetric(experimentId, user.id, name, definition as Record<string, unknown>);
    return json(toSavedCustomMetricDto(metric), 201);
  });
}
