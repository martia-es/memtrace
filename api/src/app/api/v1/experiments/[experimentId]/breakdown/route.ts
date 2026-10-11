import { z } from "zod";
import { toBreakdownResponse } from "@/adapters/inbound/http/breakdown-mappers";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { parseOrThrow, queryToObject, timeRangeShape } from "@/adapters/inbound/http/schemas";
import { getBreakdown } from "@/dependency-container";
import { BREAKDOWN_GROUPS } from "@/domain/breakdown";

export const dynamic = "force-dynamic";

const breakdownQuery = z.object({ ...timeRangeShape, groupBy: z.enum(BREAKDOWN_GROUPS) });

/**
 * Overview › Breakdown: las trazas del agente agrupadas por versión de prompt o por entorno, con coste, errores con su
 * margen del 95 %, latencia, 👍 y la tendencia de errores de 7 días. Son datos del agente, así que exige leer el experimento;
 * un `org_admin` no lee datos.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const { from, to, groupBy } = parseOrThrow(breakdownQuery, queryToObject(new URL(request.url).searchParams));
    return json(toBreakdownResponse(await getBreakdown().breakdown(ctx.scope, { groupBy, from, to })));
  });
}
