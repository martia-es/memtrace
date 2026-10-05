import { ASSISTANT_GOVERN, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; deploymentId: string; grantId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, deploymentId, grantId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_GOVERN);
    if (ctx instanceof Response) return ctx;
    await getAssistantRegistry().removeGrant(experimentId, deploymentId, grantId);
    return new Response(null, { status: 204 });
  });
}
