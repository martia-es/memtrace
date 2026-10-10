import { actorOf, auditContext } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { looseObjectBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAlerts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Cambia una regla (el objeto completo, igual que al crearla). Reinicia su estado. Requiere `alert:manage`. */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string; ruleId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, ruleId } = await context.params;
    const access = await requirePermission(experimentId, "alert:manage");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(looseObjectBody, request);
    return json(await getAlerts().updateRule(auditContext(access, experimentId), actorOf(access.user), ruleId, body));
  });
}

/** Borra una regla, con su estado y su historial. Requiere `alert:manage`. */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string; ruleId: string }> }) {
  return identityGuard(async () => {
    const { experimentId, ruleId } = await context.params;
    const access = await requirePermission(experimentId, "alert:manage");
    if (access instanceof Response) return access;
    await getAlerts().deleteRule(auditContext(access, experimentId), actorOf(access.user), ruleId);
    return json({ deleted: true });
  });
}
