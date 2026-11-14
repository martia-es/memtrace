import { requirePermission } from "@/adapters/inbound/http/auth-context";
import type { PromptGraphResponse } from "@/adapters/inbound/http/contract";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { toPromptSummaryDto } from "@/adapters/inbound/http/prompt-mappers";
import { getIdentity, getPromptMap, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Grafo global de los prompts y fragmentos de este agente: nodos y qué fragmento incluye cada prompt, con la versión fijada
 * y si el fragmento ya va por delante (ADR-073/074). Solo lee, no incluye archivados. Requiere `prompt:read`.
 */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");
    const items = await getPrompts().list(experiment.organizationId, { experimentId, includeArchived: false });
    const edges = await getPromptMap().graph(items);
    const nodes = items.map(toPromptSummaryDto).map((p) => ({ id: p.id, name: p.name, kind: p.kind, latestVersion: p.latestVersion }));
    return json({ nodes, edges } satisfies PromptGraphResponse);
  });
}
