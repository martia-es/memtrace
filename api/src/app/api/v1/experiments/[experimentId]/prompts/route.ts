import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import type { PromptListResponse } from "@/adapters/inbound/http/contract";
import { toPromptDetailDto, toPromptSummaryDto } from "@/adapters/inbound/http/prompt-mappers";
import { createPromptBody } from "@/adapters/inbound/http/prompt-schemas";
import { getIdentity, getPrompts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Prompts de este agente (ADR-067). `?archived=true` incluye los archivados. Requiere `prompt:read` sobre el experimento. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "prompt:read");
    if (ctx instanceof Response) return ctx;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");
    const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
    const items = await getPrompts().list(experiment.organizationId, { experimentId, includeArchived });
    return json({ items: items.map(toPromptSummaryDto) } satisfies PromptListResponse);
  });
}

/** Crea un prompt en la organización del agente y lo asocia a este agente (y a los de `experimentIds`, si los hay). Requiere `prompt:write`. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "prompt:write");
    if (ctx instanceof Response) return ctx;
    const experiment = await getIdentity().identityRepository.getExperiment(experimentId);
    if (!experiment) return problem(404, "Not Found", "Experiment not found");
    const body = await parseJsonOrThrow(createPromptBody, request);
    const detail = await getPrompts().create(experiment.organizationId, ctx.user.id, { ...body, experimentIds: [experimentId, ...body.experimentIds] });
    return json(toPromptDetailDto(detail), 201);
  });
}
