import { z } from "zod";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { toPromptFailuresResponse } from "@/adapters/inbound/http/prompt-mappers";
import { parseOrThrow, queryToObject, timeRangeShape } from "@/adapters/inbound/http/schemas";
import { getPromptFailures, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

const failuresQuery = z.object({ ...timeRangeShape });

/**
 * Fallos recientes de un prompt (ADR-077): sus últimas trazas que tienen un paso fallido, un score bajo, una etiqueta
 * humana negativa o un 👎 del usuario final, cada una con sus motivos. Son datos del agente: exige leer el experimento
 * además de `prompt:read`, y el prompt tiene que ser de este agente.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string; promptId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, promptId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    if (!ctx.permissions.includes("prompt:read")) return problem(403, "Forbidden", "Missing permission: prompt:read");

    const prompt = await getPrompts().get(promptId);
    if (!prompt.experimentIds.includes(experimentId)) return problem(404, "Not Found", "Prompt not found for this agent");

    const { from, to } = parseOrThrow(failuresQuery, queryToObject(new URL(request.url).searchParams));
    return json(toPromptFailuresResponse(await getPromptFailures().list(ctx.scope, prompt.name, { from, to })));
  });
}
