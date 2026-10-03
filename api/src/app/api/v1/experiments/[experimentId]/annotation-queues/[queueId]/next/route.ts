import { requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toQueueItemDto } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Reclama el siguiente item libre para el usuario (o devuelve el que ya tenía abierto). `item: null` si no queda ninguno. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string; queueId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, queueId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;
    const item = await getAnnotationQueues().next({ userId: ctx.user.id, experimentId, serviceName: ctx.serviceName }, queueId);
    return json({ item: item ? toQueueItemDto(item) : null });
  });
}
