import { ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Registra en el catálogo las tools vistas en trazas (las nuevas quedan `pending`). Idempotente. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    return json(await getAssistantRegistry().syncObservedConnections(experimentId, ctx.serviceName));
  });
}
