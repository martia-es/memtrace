import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toFeedbackOverviewResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { feedbackOverviewQuery, parseOrThrow, queryToObject } from "@/adapters/inbound/http/schemas";
import { resolveTimeRange } from "@/domain/time-range";
import { getUserFeedback } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Satisfacción, serie diaria, alineación con la revisión humana y últimas trazas con 👎 del rango (ADR-062). Cualquier miembro. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const range = resolveTimeRange(parseOrThrow(feedbackOverviewQuery, queryToObject(new URL(request.url).searchParams)), Date.now());
    return json(toFeedbackOverviewResponse(await getUserFeedback().overview(experimentId, ctx.serviceName, range)));
  });
}
