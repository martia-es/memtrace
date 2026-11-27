import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getLessons } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Una lección con sus versiones, evidencia (ids de traza), activaciones e historial (ADR-104). Requiere `lesson:read`. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string; lessonId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, lessonId } = await context.params;
    const access = await requirePermission(experimentId, "lesson:read");
    if (access instanceof Response) return access;
    return json(await getLessons().get(experimentId, lessonId));
  });
}
