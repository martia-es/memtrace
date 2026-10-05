import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { toQueueItemDto } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Marca el item como no revisable (p.ej. la traza ya no existe): deja de repartirse. Solo admin. */
export async function POST(_request: Request, context: { params: Promise<{ experimentId: string; queueId: string; itemId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, queueId, itemId } = await context.params;
    const ctx = await requirePermission(experimentId, "queue:manage");
    if (ctx instanceof Response) return ctx;
    return json({ item: toQueueItemDto(await getAnnotationQueues().markUnreviewable(experimentId, queueId, itemId)) });
  });
}
