import { ASSISTANT_READ, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { chatBody } from "@/adapters/inbound/http/assistant-schemas";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry, getChatClient } from "@/dependency-container";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Chat con el agente en un entorno (ADR-055). El navegador no llama al asistente: pasa por aquí para evitar CORS, no exponer
 * su URL interna y aplicar la protección SSRF. Quien ve la ficha puede hablar con el agente.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; deploymentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, deploymentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, ASSISTANT_READ);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(chatBody, request);
    return json(await getAssistantRegistry().chat(experimentId, deploymentId, { message: body.message, sessionId: body.sessionId }, getChatClient()));
  });
}
