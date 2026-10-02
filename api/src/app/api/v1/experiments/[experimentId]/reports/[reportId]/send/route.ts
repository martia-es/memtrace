import { requireUser } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { sendMetricReportEmailBody } from "@/adapters/inbound/http/schemas";
import type { ReportChartSnapshot } from "@/application/ports/email-sender";
import { getIdentity, getTraceQueryService } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Envía una instantánea en texto del informe por email (ADR-033): recalcula cada chart ahora mismo
 * (mismo cómputo que ve el dashboard en vivo) y manda una tabla de valores por gráfico, sin PDF ni
 * imagen renderizada — eso queda fuera de alcance de esta ADR. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; reportId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, reportId } = await context.params;
    const user = await requireUser();
    if (user instanceof Response) return user;

    const { authorizationService, identityRepository, emailSender } = getIdentity();
    if (!(await authorizationService.canReadExperiment(user.id, experimentId))) {
      return problem(403, "Forbidden", "No access to this experiment");
    }

    const [report, experiment] = await Promise.all([identityRepository.getMetricReport(experimentId, reportId), identityRepository.getExperiment(experimentId)]);
    if (!report || !experiment) return problem(404, "Not Found", "Report not found");

    const { toEmails } = await parseJsonOrThrow(sendMetricReportEmailBody, request);

    const traceQueryService = getTraceQueryService();
    const charts: ReportChartSnapshot[] = await Promise.all(
      report.charts.map(async (c): Promise<ReportChartSnapshot> => {
        const definition = c.definition as { chartType: string; stepTypes: string[]; metric: string; groupByAttribute: string | null; filters: unknown[] };
        try {
          const result = await traceQueryService.getCustomMetric({ ...definition, service: experiment.serviceName } as never);
          const rows = result.points.length
            ? result.points
            : summarizeTimeseries(result.timeseries);
          return { name: c.name, rows };
        } catch {
          return { name: c.name, rows: [] };
        }
      }),
    );

    await emailSender.sendReportSnapshotEmail({
      to: toEmails,
      reportName: report.name,
      experimentName: experiment.name,
      charts,
      appUrl: new URL(request.url).origin,
    });
    return json({ status: "ok" });
  });
}

/** Para line/area el resultado vive en `timeseries`, no en `points` (ADR-027): se suma cada serie a
 * través de los buckets para dar un número representativo en el resumen de texto del email. */
function summarizeTimeseries(timeseries: Array<{ points: Array<{ label: string; value: number }> }>): Array<{ label: string; value: number }> {
  const totals = new Map<string, number>();
  for (const bucket of timeseries) {
    for (const p of bucket.points) {
      totals.set(p.label, (totals.get(p.label) ?? 0) + p.value);
    }
  }
  return [...totals.entries()].map(([label, value]) => ({ label, value }));
}
