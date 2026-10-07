import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { parseOrThrow, queryToObject, ratingsQuery } from "@/adapters/inbound/http/schemas";
import { getUserFeedback } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Votos de usuario final (👍/👎) de las trazas o conversaciones de una página de lista (ADR-062). Cualquier miembro. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const query = parseOrThrow(ratingsQuery, queryToObject(new URL(request.url).searchParams));
    const target = query.traceIds ? { traceIds: query.traceIds } : { conversationIds: query.conversationIds! };
    return json({ items: await getUserFeedback().listRatings(ctx.serviceName, target) });
  });
}
