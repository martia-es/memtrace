import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toLowRatedResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { lowRatedQuery, parseOrThrow, queryToObject } from "@/adapters/inbound/http/schemas";
import { resolveTimeRange } from "@/domain/time-range";
import { getAnnotation } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Trazas con alguna valoración humana baja en el rango, para el aviso "Needs attention" del dashboard (ADR-049). Cualquier miembro. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const range = resolveTimeRange(parseOrThrow(lowRatedQuery, queryToObject(new URL(request.url).searchParams)), Date.now());
    return json(toLowRatedResponse(await getAnnotation().listLowRated(ctx.scope, range)));
  });
}
