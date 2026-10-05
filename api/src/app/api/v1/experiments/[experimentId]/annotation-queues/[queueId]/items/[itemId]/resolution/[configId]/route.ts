import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toQueueResolutionDto } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { resolveQueueItemBody } from "@/adapters/inbound/http/schemas";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; queueId: string; itemId: string; configId: string }> };

/** El técnico fija el valor final de un criterio (y, opcional, la respuesta correcta). Crea o sustituye. Solo admin (ADR-050). */
export async function PUT(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId, itemId, configId } = await context.params;
    const ctx = await requirePermission(experimentId, "queue:curate");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(resolveQueueItemBody, request);
    return json(toQueueResolutionDto(await getAnnotationQueues().resolve(experimentId, ctx.user.id, queueId, itemId, { configId, ...body })));
  });
}

/** Retira la resolución; vuelve a valer lo que digan los revisores. Solo admin. */
export async function DELETE(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId, itemId, configId } = await context.params;
    const ctx = await requirePermission(experimentId, "queue:curate");
    if (ctx instanceof Response) return ctx;
    await getAnnotationQueues().clearResolution(experimentId, queueId, itemId, configId);
    return new Response(null, { status: 204 });
  });
}
