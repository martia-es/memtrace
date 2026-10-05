import { ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toDeploymentDto } from "@/adapters/inbound/http/assistant-mappers";
import { createDeploymentBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Despliega el asistente en un entorno (API, /health, versión y método de autenticación; nunca secretos). Uno por entorno. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_WRITE);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(createDeploymentBody, request);
    return json(toDeploymentDto(await getAssistantRegistry().createDeployment(experimentId, body)), 201);
  });
}
