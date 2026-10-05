import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { json } from "@/adapters/inbound/http/problem";
import { getAnnotationQueues } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Personas que se pueden asignar como revisoras (ADR-051): miembros del experimento y org_admin de su organización. Solo admin. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const ctx = await requirePermission(experimentId, "queue:manage");
    if (ctx instanceof Response) return ctx;
    const members = await getAnnotationQueues().reviewerCandidates(experimentId);
    return json({ candidates: members.map((m) => ({ userId: m.userId, name: m.name, email: m.email })) });
  });
}
