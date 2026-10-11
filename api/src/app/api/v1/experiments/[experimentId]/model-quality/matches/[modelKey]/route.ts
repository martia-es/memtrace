import { actorOf } from "@/adapters/inbound/http/audit-context";
import { requirePermission } from "@/adapters/inbound/http/auth-context";
import { identityGuard } from "@/adapters/inbound/http/identity-guard";
import { modelMatchBody, parseJsonOrThrow } from "@/adapters/inbound/http/identity-schemas";
import { json, problem } from "@/adapters/inbound/http/problem";
import { getModelQuality } from "@/dependency-container";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ experimentId: string; modelKey: string }> };

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Decide qué entrada de Arena es este modelo (ADR-025): `{ decision: "confirm", arenaName }`, `{ decision: "reject", arenaNames }` o
 * `{ decision: "no_equivalent" }`. Vale para toda la organización y queda en la auditoría. Requiere `pricing:manage`.
 */
export async function PUT(request: Request, context: Context) {
  return identityGuard(async () => {
    const { experimentId, modelKey } = await context.params;
    const access = await requirePermission(experimentId, "pricing:manage");
    if (access instanceof Response) return access;
    const body = await parseJsonOrThrow(modelMatchBody, request);
    await getModelQuality().decide({ organizationId: access.organizationId, scope: access.scope, experimentId }, actorOf(access.user), decode(modelKey), body);
    return new Response(null, { status: 204 });
  });
}

/** Quita todas las decisiones sobre este modelo: vuelve a lo automático. Requiere `pricing:manage`. */
export async function DELETE(_request: Request, context: Context) {
  return identityGuard(async () => {
    const { experimentId, modelKey } = await context.params;
    const access = await requirePermission(experimentId, "pricing:manage");
    if (access instanceof Response) return access;
    const cleared = await getModelQuality().clear({ organizationId: access.organizationId, scope: access.scope, experimentId }, actorOf(access.user), decode(modelKey));
    return cleared ? new Response(null, { status: 204 }) : problem(404, "Not Found", "There was no decision for this model");
  });
}
