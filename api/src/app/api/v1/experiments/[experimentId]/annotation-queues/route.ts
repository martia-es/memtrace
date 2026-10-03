import { requireExperimentAdmin, requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toAnnotationQueueDto, toAnnotationQueuesListResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { createAnnotationQueueBody } from "@/adapters/inbound/http/schemas";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string }> };

/** Colas del experimento con su progreso (ADR-039). Cualquier miembro; `?includeArchived=true` incluye las archivadas. */
export async function GET(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    return json(toAnnotationQueuesListResponse(await getAnnotationQueues().list(experimentId, includeArchived)));
  });
}

/** Crea una cola. Solo admin del experimento (u org_admin). */
export async function POST(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requireExperimentAdmin(experimentId);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(createAnnotationQueueBody, request);
    return json(toAnnotationQueueDto(await getAnnotationQueues().create(experimentId, ctx.user.id, body)), 201);
  });
}
