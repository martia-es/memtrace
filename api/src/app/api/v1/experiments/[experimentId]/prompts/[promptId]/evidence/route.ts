import { z } from "zod";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { toPromptEvidenceResponse } from "@/adapters/inbound/http/prompt-mappers";
import { parseOrThrow, queryToObject, timeRangeShape } from "@/adapters/inbound/http/schemas";
import { getPromptEvidence, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

const evidenceQuery = z.object({ ...timeRangeShape });

/**
 * Evidencia por versión de un prompt (ADR-069): para cada versión con tráfico en el rango, cuántas trazas, errores por
 * causa, latencia, coste, feedback y scores de evaluación de las trazas que la usaron. Son datos del agente, así que
 * exige leer el experimento además de `prompt:read` (un `org_admin` no lee datos). El prompt tiene que ser de este agente.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string; promptId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, promptId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    if (!ctx.permissions.includes("prompt:read")) return problem(403, "Forbidden", "Missing permission: prompt:read");

    const prompt = await getPrompts().get(promptId);
    if (!prompt.experimentIds.includes(experimentId)) return problem(404, "Not Found", "Prompt not found for this agent");

    const { from, to } = parseOrThrow(evidenceQuery, queryToObject(new URL(request.url).searchParams));
    return json(toPromptEvidenceResponse(await getPromptEvidence().forPrompt(prompt.name, ctx.serviceName, { from, to })));
  });
}
