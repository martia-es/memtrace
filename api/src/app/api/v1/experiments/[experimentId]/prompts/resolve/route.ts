import { requireExperimentAccess } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json, problem } from "@/adapters/inbound/http/problem";
import { promptEtag, toPromptResolveDto } from "@/adapters/inbound/http/prompt-mappers";
import { resolvePromptQuery } from "@/adapters/inbound/http/prompt-schemas";
import { parseOrThrow } from "@/adapters/inbound/http/schemas";
import { getIdentity, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Lo que pide el SDK del agente (ADR-068): `?name=weather-system&tag=pro` o `&version=3`. Acepta la API key del agente
 * (`Authorization: Bearer`) o una sesión. El SDK lo llama al arrancar y luego cada pocos segundos para seguir el tag, así
 * que responde `304` si trae `If-None-Match` con la versión y el texto que ya tiene.
 */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requireExperimentAccess(experimentId, request);
    if (access instanceof Response) return access;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");

    const params = new URL(request.url).searchParams;
    const { name, tag, version } = parseOrThrow(resolvePromptQuery, { name: params.get("name") ?? undefined, tag: params.get("tag") ?? undefined, version: params.get("version") ?? undefined });
    const resolved = await getPrompts().resolveForAgent(experimentId, experiment.organizationId, name, { tag, version });

    const etag = promptEtag(resolved.version);
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    const response = json(toPromptResolveDto(resolved.prompt, resolved.version, resolved.tag));
    response.headers.set("ETag", etag);
    return response;
  });
}
