import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toMetricReportDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { setMetricReportChartsBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Reemplaza por completo el conjunto de charts y su layout de grid del informe (ADR-033): el editor
 * de grid siempre guarda el estado entero, no cambios incrementales. */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string; reportId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, reportId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const { charts } = await parseJsonOrThrow(setMetricReportChartsBody, request);
    await identityRepository.setMetricReportCharts(experimentId, reportId, charts);
    const report = await identityRepository.getMetricReport(experimentId, reportId);
    if (!report) return problem(404, "Not Found", "Report not found");
    return json(toMetricReportDto(report));
  });
}
