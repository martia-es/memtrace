import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toMetricReportsListResponse, toMetricReportSummaryDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { createMetricReportBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Lista los informes guardados del experimento (ADR-033). Requiere solo acceso de lectura. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    return json(toMetricReportsListResponse(await identityRepository.listMetricReports(experimentId)));
  });
}

/** Crea un informe vacío (sin charts); se le añaden con PUT .../charts (ADR-033). */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const { name } = await parseJsonOrThrow(createMetricReportBody, request);
    const report = await identityRepository.createMetricReport(experimentId, user.id, name);
    return json(toMetricReportSummaryDto(report), 201);
  });
}
