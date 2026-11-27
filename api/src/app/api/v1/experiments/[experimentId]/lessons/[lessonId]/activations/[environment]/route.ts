import { actorOf } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getLessons } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ experimentId: string; lessonId: string; environment: string }> };

/** Activa la versión aprobada en un entorno (`dev`, `pre`, `pro`…). Solo una lección `approved` (ADR-104). Requiere `lesson:approve`. */
export async function PUT(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, lessonId, environment } = await context.params;
    const access = await requirePermission(experimentId, "lesson:approve");
    if (access instanceof Response) return access;
    return json(await getLessons().activate(experimentId, lessonId, environment, actorOf(access.user)));
  });
}

/** Quita la lección de ese entorno. Requiere `lesson:approve`. */
export async function DELETE(_request: Request, context: Params) {
  return identityGuard(async () => {
    const { experimentId, lessonId, environment } = await context.params;
    const access = await requirePermission(experimentId, "lesson:approve");
    if (access instanceof Response) return access;
    await getLessons().deactivate(experimentId, lessonId, environment, actorOf(access.user));
    return json({ deactivated: true });
  });
}
