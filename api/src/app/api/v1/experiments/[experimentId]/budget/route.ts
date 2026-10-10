import { actorOf, auditContext } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { looseObjectBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json } from "@/adapters/inbound/http/problem";
import { getAlerts } from "@/dependency-container";

export const dynamic = "force-dynamic";

/** Presupuesto mensual de coste del agente con lo gastado este mes, o `{ budget: null }` (ADR-086). Requiere `experiment:read`. */
export async function GET(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "experiment:read");
    if (access instanceof Response) return access;
    return json({ budget: await getAlerts().budgetView(experimentId) });
  });
}

/** Crea o cambia el presupuesto: `{ monthlyUsd, warnPercent?, recipients?, enabled? }`. Requiere `alert:manage`. */
export async function PUT(request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "alert:manage");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(looseObjectBody, request);
    return json(await getAlerts().setBudget(auditContext(access, experimentId), actorOf(access.user), body));
  });
}

/** Quita el presupuesto. Requiere `alert:manage`. */
export async function DELETE(_request: Request, context: { params: Promise<{ experimentId: string }> }) {
  return identityGuard(async () => {
    const { experimentId } = await context.params;
    const access = await requirePermission(experimentId, "alert:manage");
    if (access instanceof Response) return access;
    await getAlerts().deleteBudget(auditContext(access, experimentId), actorOf(access.user));
    return json({ deleted: true });
  });
}
