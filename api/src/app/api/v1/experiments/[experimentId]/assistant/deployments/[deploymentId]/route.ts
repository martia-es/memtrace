import { ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toDeploymentDto } from "@/adapters/inbound/http/assistant-mappers";
import { updateDeploymentBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ experimentId: string; deploymentId: string }> };

export async function PATCH(request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(updateDeploymentBody, request);
    return json(toDeploymentDto(await getAssistantRegistry().updateDeployment(experimentId, deploymentId, body)));
  });
}

export async function DELETE(_request: Request, context: Ctx) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    await getAssistantRegistry().deleteDeployment(experimentId, deploymentId);
    return new Response(null, { status: 204 });
  });
}
