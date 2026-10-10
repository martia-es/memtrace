import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { parseOrThrow, queryToObject, ratingsQuery } from "@/adapters/inbound/http/schemas";
import { getAnnotation } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Estado de anotación (etiquetas humanas y si alguna es baja) de las trazas o conversaciones de una página de lista. Cualquier miembro. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const query = parseOrThrow(ratingsQuery, queryToObject(new URL(request.url).searchParams));
    const target = query.traceIds ? { traceIds: query.traceIds } : { conversationIds: query.conversationIds! };
    return json({ items: await getAnnotation().listRatings(ctx.scope, target) });
  });
}
