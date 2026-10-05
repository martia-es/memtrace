import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; traceId: string }> };

/** Colas de revisión que contienen la traza y el estado de su item (ADR-050). Cualquier miembro. */
export async function GET(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, traceId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    return json({ items: await getAnnotationQueues().queuesForTrace(experimentId, traceId) });
  });
}
