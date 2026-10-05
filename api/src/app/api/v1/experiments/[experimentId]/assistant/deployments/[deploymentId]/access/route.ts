import { ASSISTANT_GOVERN, ASSISTANT_READ, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toAccessGrantDto } from "@/adapters/inbound/http/assistant-mappers";
import { addGrantBody } from "@/adapters/inbound/http/assistant-schemas";
import type { AccessGrantsResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ experimentId: string; deploymentId: string }> };

/** Quién puede llamar a este despliegue (documentado y sincronizado; MemTrace no lo hace cumplir). */
export async function GET(_request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const items = await getAssistantRegistry().listGrants(experimentId, deploymentId);
    return json({ items: items.map(toAccessGrantDto) } satisfies AccessGrantsResponse);
  });
}

/** Añade un acceso (usuario, grupo del proveedor de identidad o todos). Solo gobernanza: `governance:manage`. */
export async function POST(request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_GOVERN);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(addGrantBody, request);
    return json(toAccessGrantDto(await getAssistantRegistry().addGrant(experimentId, deploymentId, body, ctx.user.id)), 201);
  });
}
