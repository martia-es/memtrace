import { ASSISTANT_READ, ASSISTANT_WRITE, requireAnyPermission } from "@/adapters/inbound/http/auth-context";
import { toEnvironmentDto } from "@/adapters/inbound/http/assistant-mappers";
import type { EnvironmentsResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getAssistantRegistry, getIdentity } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Entornos de la organización del experimento (DEV/PRE/PRO por defecto), para elegir dónde desplegar. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireAnyPermission(experimentId, [...ASSISTANT_READ, ...ASSISTANT_WRITE]);
    if (ctx instanceof Response) return ctx;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");
    const items = await getAssistantRegistry().listEnvironments(experiment.organizationId);
    return json({ items: items.map(toEnvironmentDto) } satisfies EnvironmentsResponse);
  });
}
