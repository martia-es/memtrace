import { ASSISTANT_GOVERN, ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toConnectionDto } from "@/adapters/inbound/http/assistant-mappers";
import { decideConnectionBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ experimentId: string; connectionId: string }> };

/** Aprueba, bloquea o devuelve a pendiente una conexión. Solo gobernanza: `governance:manage`. */
export async function PATCH(request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, connectionId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_GOVERN);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(decideConnectionBody, request);
    const connection = await getAssistantRegistry().decideConnection(experimentId, connectionId, body.status, ctx.user.id, body.note);
    return json(toConnectionDto({ ...connection, usage: null }));
  });
}

/** Quita la declaración. Si la conexión se ha visto en trazas, sigue como solo observada. */
export async function DELETE(_request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, connectionId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    await getAssistantRegistry().undeclareConnection(experimentId, connectionId);
    return new Response(null, { status: 204 });
  });
}
