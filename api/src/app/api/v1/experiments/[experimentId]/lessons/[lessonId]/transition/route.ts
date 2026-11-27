import { actorOf } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { looseObjectBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getLessons } from "@/dependency-container";

export const dynamic = "force-dynamic";

/**
 * Cambia el estado de la lección. Body: `{ to, comment? }`. El permiso depende del paso: revisar, devolver y descartar piden
 * `lesson:review`; aprobar, retirar y declarar obsoleta piden `lesson:approve` (ADR-104). Aquí basta con `lesson:read`.
 */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string; lessonId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, lessonId } = await context.params;
    const access = await requirePermission(experimentId, "lesson:read");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(looseObjectBody, request);
    return json(await getLessons().transition(experimentId, lessonId, actorOf(access.user), access.permissions, body));
  });
}
