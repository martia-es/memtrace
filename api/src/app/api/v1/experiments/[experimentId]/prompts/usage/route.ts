import { requireExperimentAccess } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { usageReportBody } from "@/adapters/inbound/http/prompt-schemas";
import { getIdentity, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Latido del SDK (ADR-068): qué versiones de qué prompts está usando el agente y en qué entorno. Acepta la API key del
 * agente. Lo que no encaja (prompt desconocido, de otro agente, versión inexistente) se ignora: un latido nunca debe
 * hacer fallar al agente. Responde cuántos anotó.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request, "prompt:write");
    if (access instanceof Response) return access;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const body = await parseJsonOrThrow(usageReportBody, request);
    const recorded = await getPrompts().recordUsage(experimentId, experiment.organizationId, body.environment ?? "", body.items);
    return json({ recorded, received: body.items.length });
  });
}
