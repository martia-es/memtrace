import { requireExperimentAdmin, requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toAnnotationQueueDetailResponse } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { updateAnnotationQueueBody } from "@/adapters/inbound/http/schemas";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; queueId: string }> };

/** Cola con su rúbrica resuelta, progreso y trabajo por revisor. Cualquier miembro. */
export async function GET(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;
    return json(toAnnotationQueueDetailResponse(await getAnnotationQueues().getDetail(experimentId, queueId)));
  });
}

/** Nombre, instrucciones, `requiredAnnotations`, rúbrica (solo crece si ya hay items) y archivado. Solo admin. */
export async function PATCH(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId } = await context.params;
    const ctx = await requireExperimentAdmin(experimentId);
    if (ctx instanceof Response) return ctx;
    const patch = await parseJsonOrThrow(updateAnnotationQueueBody, request);
    await getAnnotationQueues().update(experimentId, queueId, patch);
    return json(toAnnotationQueueDetailResponse(await getAnnotationQueues().getDetail(experimentId, queueId)));
  });
}
