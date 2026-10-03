import { requireExperimentMember } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toQueueItemDto } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { completeQueueItemBody } from "@/adapters/inbound/http/schemas";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Envía las etiquetas del item (validadas contra la rúbrica) y cierra el claim del usuario. Idempotente. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; queueId: string; itemId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, queueId, itemId } = await context.params;
    const ctx = await requireExperimentMember(experimentId);
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(completeQueueItemBody, request);
    const item = await getAnnotationQueues().complete({ userId: ctx.user.id, experimentId, serviceName: ctx.serviceName }, queueId, itemId, body.labels);
    return json({ item: toQueueItemDto(item) });
  });
}
