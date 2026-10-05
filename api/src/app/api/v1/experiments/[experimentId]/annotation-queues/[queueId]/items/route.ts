import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { toQueueItemDto } from "@/adapters/inbound/http/mappers";
import { json } from "@/adapters/inbound/http/problem";
import { addQueueItemsBody, listQueueItemsQuery } from "@/adapters/inbound/http/schemas";
import { ValidationError } from "@/domain/errors";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; queueId: string }> };

/** Items de la cola en orden de alta, opcionalmente filtrados por estado. Cualquier miembro. */
export async function GET(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId } = await context.params;
    const ctx = await requirePermission(experimentId, "experiment:read");
    if (ctx instanceof Response) return ctx;
    const parsed = listQueueItemsQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ValidationError("Invalid query", { query: parsed.error.issues[0]?.message ?? "invalid" });
    const items = await getAnnotationQueues().listItems(experimentId, queueId, parsed.data.status, parsed.data.limit);
    return json({ items: items.map(toQueueItemDto) });
  });
}

/** Añade trazas (ids explícitos o instantánea de un filtro) o items de una run. Cualquier miembro. */
export async function POST(request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, queueId } = await context.params;
    const ctx = await requirePermission(experimentId, "queue:manage");
    if (ctx instanceof Response) return ctx;
    const body = await parseJsonOrThrow(addQueueItemsBody, request);
    const actor = { userId: ctx.user.id, experimentId, serviceName: ctx.serviceName };
    return json(await getAnnotationQueues().addItems(actor, queueId, body), 201);
  });
}
