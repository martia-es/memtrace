import { actorOf } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { looseObjectBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getLessons } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Edita el texto: crea una versión nueva, la lección vuelve a `proposed` y se desactiva donde estuviera servida (ADR-104). Requiere `lesson:review`. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; lessonId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, lessonId } = await context.params;
    const access = await requirePermission(experimentId, "lesson:review");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(looseObjectBody, request);
    return json(await getLessons().edit(experimentId, lessonId, actorOf(access.user), body), 201);
  });
}
