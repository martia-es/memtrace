import { actorOf } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { looseObjectBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getLessons } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Las lecciones del agente con su texto vigente y los entornos donde están activas (ADR-104). `status` filtra. Requiere `lesson:read`. */
export async function GET(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "lesson:read");
    if (access instanceof Response) return access;
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return json({ items: await getLessons().list(experimentId, status) });
  });
}

/** Propone una lección: de un hallazgo de Mem (`findingId`, una por hallazgo) o escrita a mano. Queda en `proposed`. Requiere `lesson:review`. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "lesson:review");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(looseObjectBody, request);
    return json(await getLessons().propose(experimentId, actorOf(access.user), body), 201);
  });
}
