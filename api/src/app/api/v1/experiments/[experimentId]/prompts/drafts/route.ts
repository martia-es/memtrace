import { requireExperimentAccess } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { toPromptVersionDto } from "@/adapters/inbound/http/prompt-mappers";
import { draftBody } from "@/adapters/inbound/http/prompt-schemas";
import { getIdentity, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Una herramienta del equipo propone un arreglo de un prompt (ADR-072), con la API key del agente: queda como **borrador** a
 * revisar. No publica ni promueve nada; solo una persona puede publicarlo. El prompt tiene que ser de este agente.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request, "prompt:write");
    if (access instanceof Response) return access;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");
    const body = await parseJsonOrThrow(draftBody, request);
    const saved = await getPrompts().saveDraftForAgent(experimentId, experiment.organizationId, access.createdByUserId, body);
    return json({ promptId: saved.prompt.id, ...toPromptVersionDto(saved.version) }, 201);
  });
}
