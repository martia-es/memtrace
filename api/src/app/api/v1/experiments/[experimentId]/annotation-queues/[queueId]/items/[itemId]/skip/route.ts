import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toQueueItemDto } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** El usuario pasa de este item; vuelve al pool para los demás revisores. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string; queueId: string; itemId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, queueId, itemId } = await context.params;
    const ctx = await requirePermission(experimentId, "annotation:write");
    if (ctx instanceof Response) return ctx;
    const item = await getAnnotationQueues().skip({ userId: ctx.user.id, experimentId, serviceName: ctx.serviceName }, queueId, itemId);
    return json({ item: toQueueItemDto(item) });
  });
}
