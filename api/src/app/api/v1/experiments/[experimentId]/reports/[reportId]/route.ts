import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toMetricReportDto } from "@/adapters/inbound/http/mappers";
import { json, problem } from "@/adapters/inbound/http/problem";
import { renameMetricReportBody } from "@/adapters/inbound/http/schemas";
import { getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Un informe con sus charts resueltos (nombre + definición + posición en el grid), para pintar la pestaña (ADR-033). */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; reportId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, reportId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const report = await identityRepository.getMetricReport(experimentId, reportId);
    if (!report) return problem(404, "Not Found", "Report not found");
    return json(toMetricReportDto(report));
  });
}

/** Renombra el informe (no toca sus charts). */
export async function PATCH(request: Request, context: { params: Promise<{ experimentId: string; reportId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, reportId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    const { name } = await parseJsonOrThrow(renameMetricReportBody, request);
    await identityRepository.renameMetricReport(experimentId, reportId, name);
    const report = await identityRepository.getMetricReport(experimentId, reportId);
    if (!report) return problem(404, "Not Found", "Report not found");
    return json(toMetricReportDto(report));
  });
}

/** Borra el informe y su layout; los custom_metrics referenciados no se tocan (ADR-033). */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; reportId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, reportId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }
    await identityRepository.deleteMetricReport(experimentId, reportId);
    return json({ status: "ok" });
  });
}
