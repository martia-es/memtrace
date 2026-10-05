import { ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toDeploymentDto } from "@/adapters/inbound/http/assistant-mappers";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry, getHealthProber } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** «Comprobar ahora»: sondea /health de este despliegue y devuelve su estado. Si se comprobó hace menos de 10 s, devuelve el actual. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string; deploymentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    return json(toDeploymentDto(await getAssistantRegistry().probeNow(experimentId, deploymentId, getHealthProber())));
  });
}
