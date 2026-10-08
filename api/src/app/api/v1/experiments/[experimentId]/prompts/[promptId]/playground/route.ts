import { requirePermission } from "@/adapters/inbound/http/auth-context";
import type { PromptPlaygroundResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { playgroundBody } from "@/adapters/inbound/http/prompt-schemas";
import { getPromptPlayground, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Prueba una versión del prompt en el asistente real, sin mover ningún tag (ADR-071). Ejecuta el agente de verdad (con sus
 * tools y su RAG), así que puede tener efectos: solo en entornos que no son de producción y exige `prompt:write` además de
 * poder leer el experimento. `applied` dice si el agente aplicó el override; si es `false`, la respuesta no es de esa versión.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; promptId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, promptId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    if (!ctx.permissions.includes("prompt:write")) return problem(403, "Forbidden", "Missing permission: prompt:write");

    const prompt = await getPrompts().get(promptId);
    const body = await parseJsonOrThrow(playgroundBody, request);
    return json((await getPromptPlayground().run(prompt, experimentId, ctx.user.id, body)) satisfies PromptPlaygroundResponse);
  });
}
