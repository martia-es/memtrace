import { actorOf, auditContext } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { looseObjectBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAlerts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Reglas de alerta del agente con su estado, historial reciente y presupuesto (ADR-086). Requiere `experiment:read`. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "experiment:read");
    if (access instanceof Response) return access;
    return json(await getAlerts().overview(experimentId));
  });
}

/** Crea una regla. Requiere `alert:manage`. Los campos se validan en el dominio y el error dice cuál falla. */
export async function POST(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "alert:manage");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(looseObjectBody, request);
    return json(await getAlerts().createRule(auditContext(access, experimentId), actorOf(access.user), body), 201);
  });
}
