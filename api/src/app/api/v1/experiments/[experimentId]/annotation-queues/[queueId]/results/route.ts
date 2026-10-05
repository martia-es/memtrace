import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toQueueResultsResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { queueResultsQuery } from "@/adapters/inbound/http/schemas";
import { ValidationError } from "@/domain/errors";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; queueId: string }> };

/**
 * Qué respondió cada revisor en cada item, con desacuerdos y resoluciones (ADR-050). Solo admin: un miembro no
 * recibe las etiquetas de los demás revisores por aquí.
 */
export async function GET(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId } = await context.params;
    const ctx = await requirePermission(experimentId, "queue:curate");
    if (ctx instanceof Response) return ctx;
    const parsed = queueResultsQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ValidationError("Invalid query", { query: parsed.error.issues[0]?.message ?? "invalid" });
    const actor = { userId: ctx.user.id, experimentId, serviceName: ctx.serviceName };
    return json(toQueueResultsResponse(await getAnnotationQueues().getResults(actor, queueId, parsed.data)));
  });
}
